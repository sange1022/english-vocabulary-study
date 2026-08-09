#!/usr/bin/env python3
"""OCR rendered TOEFL book pages with two independent language passes."""

from __future__ import annotations

import argparse
import json
import os
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path


def recognize(image_path: str, languages: list[str]) -> list[dict]:
    from ocrmac import ocrmac

    rows = ocrmac.OCR(
        image_path,
        recognition_level="accurate",
        language_preference=languages,
        confidence_threshold=0.25,
        detail=True,
        unit="line",
    ).recognize(px=True)
    return [
        {
            "text": text,
            "confidence": round(float(confidence), 3),
            "box": [round(float(value), 2) for value in box],
        }
        for text, confidence, box in rows
    ]


def process_page(task: tuple[int, str, str]) -> tuple[int, int]:
    page, image_path, output_path = task
    if Path(output_path).exists():
        return page, 0

    from PIL import Image

    with Image.open(image_path) as image:
        size = list(image.size)
    data = {
        "page": page,
        "size": size,
        "english": recognize(image_path, ["en-US", "zh-Hans"]),
        "chinese": recognize(image_path, ["zh-Hans", "en-US"]),
    }
    Path(output_path).write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    return page, len(data["english"]) + len(data["chinese"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("images", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--first", type=int, default=19)
    parser.add_argument("--last", type=int, default=458)
    parser.add_argument("--workers", type=int, default=min(6, os.cpu_count() or 2))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    tasks = []
    for page in range(args.first, args.last + 1):
        image_path = args.images / f"page-{page:03d}.jpg"
        output_path = args.output / f"page-{page:03d}.json"
        if image_path.exists():
            tasks.append((page, str(image_path), str(output_path)))

    completed = 0
    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        futures = [executor.submit(process_page, task) for task in tasks]
        for future in as_completed(futures):
            page, lines = future.result()
            completed += 1
            if completed % 10 == 0 or completed == len(tasks):
                print(f"OCR {completed}/{len(tasks)} pages (latest {page}, {lines} lines)", flush=True)


if __name__ == "__main__":
    main()
