"""Auth, CSRF and the audit log, shared by every route that changes something (docs/API.md "Auth").

One secret, PIDASH_TOKEN. A request is signed in by either:
- `Authorization: Bearer <token>`: scripts and curl; or
- the session cookie from POST /api/auth/login: browsers, and the only auth a browser WebSocket can carry.

CSRF: a browser attaches the cookie by itself, so every cookie-signed POST/PUT/PATCH/DELETE, and login and
logout, must also send `X-Pidash-CSRF: 1`. Another site can't add that header without a CORS preflight, which
pidash never grants. The cookie is also HttpOnly and SameSite=Strict.

Usage:
- HTTP route: `dependencies=[Depends(auth.require)]`. A test fails if a POST/PUT/PATCH/DELETE route lacks it.
- WebSocket route, before `ws.accept()` (app.state.auth is the Auth):

      if not same_origin(ws.headers) or not auth.check(ws):
          await ws.close(code=1008)  # uvicorn answers the handshake with HTTP 403
          return
      auth.audit(ws, "console start")

- `Audited` (added in app.py) logs every POST/PUT/PATCH/DELETE under /api/ to $PIDASH_STATE_DIR/audit.log.
"""

import hashlib
import hmac
import json
import logging
import os
import time
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import Request
from fastapi.responses import JSONResponse

log = logging.getLogger("pidash")

COOKIE = "pidash_session"
CSRF_HEADER = "x-pidash-csrf"
SESSION_S = 7 * 86400
SAFE = ("GET", "HEAD", "OPTIONS")
NOT_CONFIGURED = (403, "auth_not_configured", "set PIDASH_TOKEN on the server to enable changes")


class ApiError(Exception):
    """Answered as {"error": code, "message": message} with this status (docs/API.md "Conventions")."""

    def __init__(self, status, code, message, headers=None):
        self.status, self.code, self.message, self.headers = status, code, message, headers


def same_origin(headers):
    """A browser's Origin must name the host it connected to (Host, or X-Forwarded-Host behind a proxy)."""
    origin = headers.get("origin")
    if origin is None:
        return True  # not a browser: curl, scripts
    try:
        o = urlsplit(origin)
        want = (o.hostname, o.port or {"http": 80, "https": 443}.get(o.scheme))
        for host in (headers.get("host"), (headers.get("x-forwarded-host") or "").split(",")[0].strip()):
            h = urlsplit("//" + host) if host else None
            if h and o.hostname and (h.hostname, h.port or want[1]) == want:
                return True
    except ValueError:  # a malformed port
        pass
    return False


def csrf(request):
    if request.method not in SAFE and request.headers.get(CSRF_HEADER) != "1":
        raise ApiError(403, "csrf_header_missing", f"a browser {request.method} must send the header X-Pidash-CSRF: 1")


class Auth:
    def __init__(self, token, state_dir):
        self.token = token
        self.audit_path = Path(state_dir) / "audit.log"

    def _sign(self, expires):
        return hmac.new(self.token.encode(), f"session {expires}".encode(), hashlib.sha256).hexdigest()

    def check(self, conn):
        """How a Request or WebSocket is signed in: "bearer", "session", or None.

        A session cookie is "<expiry>.<HMAC of it, keyed by the token>": nothing is stored, so sessions survive
        restarts and reboots, and changing PIDASH_TOKEN ends them all.
        ponytail: stateless, so logout can't revoke a copied cookie before it expires (SESSION_S); keep a server-side
        session list if that ever matters.
        """
        if not self.token:
            return None
        scheme, _, given = conn.headers.get("authorization", "").partition(" ")
        if scheme.lower() == "bearer" and hmac.compare_digest(given.strip().encode(), self.token.encode()):
            return "bearer"
        expires, _, sig = conn.cookies.get(COOKIE, "").partition(".")
        if expires.isdigit() and int(expires) > time.time() and hmac.compare_digest(sig.encode(), self._sign(expires).encode()):
            return "session"
        return None

    async def require(self, request: Request):
        """The dependency for every endpoint that changes something: Depends(auth.require)."""
        if not self.token:
            raise ApiError(*NOT_CONFIGURED)
        via = self.check(request)
        if via is None:
            raise ApiError(401, "unauthorized", "missing or invalid bearer token", {"WWW-Authenticate": "Bearer"})
        if via == "session":
            csrf(request)

    def login(self, request, body):
        """POST /api/auth/login {"token": "..."}: a session cookie for the token."""
        csrf(request)
        if not self.token:
            raise ApiError(*NOT_CONFIGURED)
        token = body.get("token") if isinstance(body, dict) else None
        if not isinstance(token, str):
            raise ApiError(422, "invalid_request", 'expected {"token": "<PIDASH_TOKEN>"}')
        if not hmac.compare_digest(token.encode(), self.token.encode()):
            raise ApiError(401, "unauthorized", "wrong token")
        expires = int(time.time()) + SESSION_S
        r = JSONResponse({"authenticated": True, "expires": expires})
        # uvicorn applies X-Forwarded-Proto from the local proxy (tailscale serve) to the scheme.
        r.set_cookie(COOKIE, f"{expires}.{self._sign(expires)}", max_age=SESSION_S, path="/api", httponly=True,
                     samesite="strict", secure=request.url.scheme == "https")
        return r

    def logout(self, request):
        """POST /api/auth/logout: drops this browser's cookie. Change PIDASH_TOKEN to end every session."""
        csrf(request)
        r = JSONResponse({"authenticated": False})
        r.delete_cookie(COOKIE, path="/api", httponly=True, samesite="strict")
        return r

    def audit(self, conn, action, **details):
        """One JSON line per action: when, who (tailnet login, address, how signed in), what. Never a body.
        `user` is the Tailscale-User-Login header: tailscale serve sets it, and strips it from what clients send."""
        line = json.dumps({"ts": round(time.time(), 3), "user": conn.headers.get("tailscale-user-login"),
                           "ip": conn.client.host if conn.client else None, "auth": self.check(conn),
                           "action": action, **details})
        log.info("audit %s", line)
        try:
            self.audit_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.audit_path, "a", opener=lambda p, flags: os.open(p, flags, 0o600)) as f:
                f.write(line + "\n")
        except OSError as e:
            log.error("could not write the audit log %s: %s", self.audit_path, e)


class Audited:
    """ASGI middleware: an audit line for every POST/PUT/PATCH/DELETE under /api/, refused ones included,
    written when the response starts."""

    def __init__(self, app, auth):
        self.app, self.auth = app, auth

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] in SAFE or not scope["path"].startswith("/api/"):
            return await self.app(scope, receive, send)
        conn, action, started = Request(scope), f"{scope['method']} {scope['path']}", False

        async def audited(message):
            nonlocal started
            if message["type"] == "http.response.start" and not started:
                started = True
                self.auth.audit(conn, action, status=message["status"])
            await send(message)

        try:
            await self.app(scope, receive, audited)
        except Exception:
            if not started:
                self.auth.audit(conn, action, status=500)
            raise
