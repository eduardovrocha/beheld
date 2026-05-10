import argparse
import sys

import uvicorn
from fastapi import FastAPI

app = FastAPI(title="DevProfile Engine", version="0.1.0")

VERSION = "0.1.0"


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "version": VERSION}


@app.get("/scores/current")
def scores_current() -> dict:
    return {
        "prompt_quality": 0,
        "test_maturity": 0,
        "tech_breadth": 0,
        "growth_rate": 0,
        "overall": 0,
        "sessions_analyzed": 0,
        "updated_at": None,
    }


@app.post("/process")
def process() -> dict:
    return {"status": "ok", "processed": 0}


def main() -> None:
    parser = argparse.ArgumentParser(description="DevProfile Scoring Engine")
    parser.add_argument("--version", action="version", version=f"devprofile-engine {VERSION}")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7338)
    args = parser.parse_args()

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
