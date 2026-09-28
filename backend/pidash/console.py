"""The web console: a bash login shell on a PTY, over the WebSocket /api/console/ws (docs/API.md "Console").

Frames: binary = the terminal's bytes, both ways (keystrokes in, output out). The client's text frames are JSON
control messages, and there is one: {"type": "resize", "cols": C, "rows": R}. The server sends no text frames.

The shell runs as the service user, inside the service's sandbox (deploy/pidash.service). A session ends when the
shell exits, the client leaves, or no input came for idle_s. Then the terminal is hung up, as when an SSH session
closes: the shell and its jobs get SIGHUP, a shell that ignores it is killed, and it is always reaped.
"""

import asyncio
import contextlib
import errno
import fcntl
import json
import logging
import os
import pty
import pwd
import struct
import termios
import time

from starlette.websockets import WebSocketDisconnect

from .auth import same_origin

log = logging.getLogger("pidash")

MAX_SESSIONS = 3
SHELL = "/bin/bash"
PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
MAX_SIZE = 1000  # columns or rows
GRACE_S = 2  # from the hangup to SIGKILL
DRAIN_S = 0.5  # to forward what an exited shell printed last
GONE = (WebSocketDisconnect, RuntimeError, OSError)  # the client went away


def resize_of(text):
    """(cols, rows) from a resize message, or None if it isn't a valid one."""
    try:
        m = json.loads(text)
        cols, rows = m["cols"], m["rows"]
        ok = m["type"] == "resize" and all(type(v) is int and 1 <= v <= MAX_SIZE for v in (cols, rows))
    except (ValueError, TypeError, KeyError):
        return None
    return (cols, rows) if ok else None


def set_size(fd, cols, rows):
    """The kernel tells the terminal's foreground job with SIGWINCH."""
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


async def until(add, remove, fd):
    """Waits until `fd` is readable (loop.add_reader) or writable (loop.add_writer)."""
    fut = asyncio.get_running_loop().create_future()
    add(fd, lambda: fut.done() or fut.set_result(None))
    try:
        await fut
    finally:
        remove(fd)


async def read(fd):
    """The next output; b"" once nothing holds the terminal open any more (EIO)."""
    loop = asyncio.get_running_loop()
    while True:
        try:
            return os.read(fd, 65536)
        except BlockingIOError:
            await until(loop.add_reader, loop.remove_reader, fd)
        except OSError as e:
            if e.errno != errno.EIO:
                raise
            return b""


async def write(fd, data):
    loop = asyncio.get_running_loop()
    view = memoryview(data)
    while view:
        try:
            view = view[os.write(fd, view):]
        except BlockingIOError:  # the input queue is full: the program isn't reading
            await until(loop.add_writer, loop.remove_writer, fd)


async def close(ws, code, reason):
    """Closes with a reason the page can show (123 bytes at most). The client may be gone already."""
    with contextlib.suppress(*GONE):
        await ws.close(code, reason.encode()[:123].decode(errors="ignore"))


class Console:
    def __init__(self, auth, enabled, idle_s, home):
        self.auth, self.enabled, self.home = auth, enabled, home
        self.idle_s = idle_s if idle_s > 0 else None
        self.open = 0  # sessions; only the event loop changes it

    async def serve(self, ws):
        """The /api/console/ws route."""
        why = ("disabled" if not self.enabled else "cross_origin" if not same_origin(ws.headers)
               else "unauthorized" if not self.auth.check(ws) else "too_many_sessions" if self.open >= MAX_SESSIONS
               else None)
        if why:
            self.auth.audit(ws, "console refused", reason=why)
            if why != "too_many_sessions":
                return await ws.close(1008)  # before accept(): uvicorn answers the handshake with HTTP 403
            await ws.accept()  # signed in: accepted, so that the page can tell why
            return await close(ws, 4429, f"{MAX_SESSIONS} console sessions are open already")
        self.open += 1  # no await since the check: no race
        try:
            await self._session(ws)
        finally:
            self.open -= 1

    def _env(self):
        """A clean environment: nothing from pidash's own (PIDASH_TOKEN)."""
        try:
            user = pwd.getpwuid(os.getuid()).pw_name
        except KeyError:
            user = str(os.getuid())
        return {"HOME": str(self.home), "USER": user, "LOGNAME": user, "SHELL": SHELL, "PATH": PATH,
                "TERM": "xterm-256color", "LANG": os.environ.get("LANG") or "C.UTF-8"}

    async def _spawn(self):
        """A shell on a new terminal: (the terminal's master fd, the process)."""
        master, slave = pty.openpty()
        try:
            set_size(master, 80, 24)  # until the page's first resize
            self.home.mkdir(mode=0o700, parents=True, exist_ok=True)
            # setsid -c: a session of its own, with this terminal as its controlling tty (job control, Ctrl+C).
            # Not preexec_fn: Python code in a child forked from a threaded process can deadlock before exec.
            proc = await asyncio.create_subprocess_exec("setsid", "-c", SHELL, "-l", stdin=slave, stdout=slave,
                                                        stderr=slave, cwd=self.home, env=self._env())
        except BaseException:
            os.close(master)
            raise
        finally:
            os.close(slave)
        os.set_blocking(master, False)
        return master, proc

    async def _session(self, ws):
        await ws.accept()
        try:
            master, proc = await self._spawn()
        except OSError as e:
            log.error("console: could not start %s: %s", SHELL, e)
            return await close(ws, 1011, f"could not start the shell: {e}")
        started, end = time.monotonic(), "client disconnected"
        self.auth.audit(ws, "console start", pid=proc.pid)
        output = asyncio.create_task(self._output(ws, master))
        input_ = asyncio.create_task(self._input(ws, master))
        shell = asyncio.create_task(proc.wait())
        try:
            await asyncio.wait((input_, shell), return_when=asyncio.FIRST_COMPLETED)
            if shell.done():  # it exited: forward what it printed last, then say so
                await asyncio.wait((output,), timeout=DRAIN_S)
                rc = shell.result()
                end = f"shell exited (status {rc})" if rc >= 0 else f"shell killed by signal {-rc}"
                await close(ws, 1000, end)
            elif input_.result():  # idle, or a malformed message
                code, end = input_.result()
                await close(ws, code, end)
        finally:
            input_.cancel()
            output.cancel()
            await asyncio.gather(input_, output, return_exceptions=True)  # their fd watches go before the fd
            os.close(master)  # hangs up: SIGHUP to the shell, which passes it on to its jobs
            # ponytail: SSH semantics. Jobs that ignore SIGHUP (nohup) outlive the session, until pidash stops and
            # systemd kills its cgroup. Sweep the session id (/proc/*/stat) with SIGKILL if that ever matters.
            if not (await asyncio.wait((shell,), timeout=GRACE_S))[0]:  # it ignores SIGHUP
                with contextlib.suppress(ProcessLookupError):
                    proc.kill()
                await shell
            self.auth.audit(ws, "console end", pid=proc.pid, duration_s=round(time.monotonic() - started, 1),
                            reason=end)

    async def _input(self, ws, master):
        """Client -> terminal, until the client leaves (None) or the session must close: (code, reason)."""
        while True:
            try:
                # Also bounds a write the terminal won't take (its program reads no input), so that no
                # abandoned session outlives idle_s.
                async with asyncio.timeout(self.idle_s):
                    msg = await ws.receive()
                    if msg.get("bytes") is not None:
                        await write(master, msg["bytes"])
                        continue
            except TimeoutError:
                return 4408, f"closed after {self.idle_s} s without input"
            except OSError:
                continue  # the terminal is gone: the shell's exit ends the session
            if msg["type"] == "websocket.disconnect":
                return None
            size = resize_of(msg.get("text"))
            if not size:
                return 1003, (f'expected {{"type": "resize", "cols": 1-{MAX_SIZE}, "rows": 1-{MAX_SIZE}}}; '
                              "send keystrokes as binary frames")
            set_size(master, *size)

    async def _output(self, ws, master):
        """Terminal -> client, until nothing holds the terminal open or the client is gone."""
        with contextlib.suppress(*GONE):
            while data := await read(master):
                await ws.send_bytes(data)
                await asyncio.sleep(0)  # a flood (`yes`) never yields otherwise: let the rest of pidash run
