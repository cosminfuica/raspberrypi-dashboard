import argparse
import os

import uvicorn


def main():
    p = argparse.ArgumentParser(prog="pidash", description="Raspberry Pi 5 dashboard server")
    p.add_argument("--host", default=os.environ.get("PIDASH_HOST", "127.0.0.1"))
    p.add_argument("--port", type=int, default=int(os.environ.get("PIDASH_PORT", "8787")))
    args = p.parse_args()
    uvicorn.run("pidash.app:app", host=args.host, port=args.port)


if __name__ == "__main__":
    main()
