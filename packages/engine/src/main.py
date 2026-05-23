import argparse
import asyncio

import uvicorn

from api import VERSION, app  # noqa: F401 — app re-exported for test compatibility


def main() -> None:
    parser = argparse.ArgumentParser(description="Beheld Scoring Engine")
    parser.add_argument("--version", action="version", version=f"beheld-engine {VERSION}")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7338)
    args = parser.parse_args()

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
