import argparse
import logging
import os
import signal

import uvicorn


class Server(uvicorn.Server):
    async def startup(self, sockets=None):
        await super().startup(sockets)
        from .fan import sd_notify
        sd_notify("READY=1")  # Type=notify: ready once the port is bound


def main():
    p = argparse.ArgumentParser(prog="pidash", description="Raspberry Pi 5 dashboard server")
    p.add_argument("--host", default=os.environ.get("PIDASH_HOST", "127.0.0.1"))
    p.add_argument("--port", type=int, default=int(os.environ.get("PIDASH_PORT", "8787")))
    p.add_argument("--mock", action="store_true", help="serve synthetic data (same as PIDASH_MOCK=1)")
    p.add_argument("--restore-fan", action="store_true",
                   help="hand the fan back to the kernel if a dead run left it released, then exit "
                        "(systemd ExecStopPost=)")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    if args.restore_fan:
        from .fan import restore_fan
        return restore_fan()

    from .app import create_app
    env = dict(os.environ)
    if args.mock:
        env["PIDASH_MOCK"] = "1"
    app = create_app(env)
    # A closed terminal must shut down cleanly too, so the fan is handed back to the kernel.
    signal.signal(signal.SIGHUP, lambda *_: signal.raise_signal(signal.SIGTERM))
    try:
        Server(uvicorn.Config(app, host=args.host, port=args.port, timeout_graceful_shutdown=5)).run()
    finally:
        app.state.fan.stop()  # a no-op after a clean shutdown; covers a forced one (second Ctrl+C)


if __name__ == "__main__":
    raise SystemExit(main())
