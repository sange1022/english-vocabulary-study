#!/usr/bin/env python3
"""Parse the dual-pass OCR output into structured TOEFL vocabulary records."""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter
from pathlib import Path

UNIT_STARTS = [
    19, 40, 61, 80, 97, 115, 133, 152, 171, 189, 208,
    228, 249, 268, 286, 305, 325, 347, 368, 386, 407,
]
FIELD_MARKERS = {
    "【释】": "meaning",
    "【例】": "example",
    "【衍】": "derivatives",
    "【近】": "synonyms",
}


def unit_for_page(page: int) -> int:
    return max(index + 1 for index, start in enumerate(UNIT_STARTS) if start <= page)


def load_dictionary(path: Path) -> dict[str, dict]:
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return {row["word"].lower(): row for row in csv.DictReader(stream) if row.get("word")}


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip(" _")


def join_lines(lines: list[str], field: str) -> str:
    output = ""
    previous = ""
    for raw in lines:
        line = clean_text(raw)
        if not line or line == previous:
            continue
        if output.endswith("-") and re.match(r"^[A-Za-z]", line):
            output = output[:-1] + line
        elif field in {"meaning", "derivatives"}:
            output += (" " if output else "") + line
        else:
            output += (" " if output else "") + line
        previous = line
    return output.strip()


def marker_for(text: str) -> tuple[str, str] | None:
    normalized = text.replace("[", "【").replace("]", "】")
    for marker, field in FIELD_MARKERS.items():
        if marker in normalized:
            return field, clean_text(normalized.split(marker, 1)[1])
    return None


def headword_candidates(page: dict, dictionary: dict[str, dict]) -> list[dict]:
    width, height = page["size"]
    labels = [row for row in page["chinese"] if marker_for(row["text"])]
    candidates = []
    for row in page["english"]:
        x, y, _, _ = row["box"]
        text = clean_text(row["text"]).lower()
        if not (height * 0.06 < y < height * 0.94 and x < width * 0.225):
            continue
        match = re.fullmatch(r"([a-z][a-z-]{2,})(?:\s+[\[\(].*)?", text)
        if not match:
            continue
        text = match.group(1)
        nearby_meaning = any(
            marker_for(label["text"])[0] == "meaning" and 0 <= label["box"][1] - y < height * 0.055
            for label in labels
        )
        if not nearby_meaning:
            continue
        candidates.append(
            {
                "type": "headword",
                "y": y,
                "word": text,
                "in_dictionary": text in dictionary,
                "confidence": row["confidence"],
            }
        )
    return candidates


def rows_between(rows: list[dict], start: float, end: float, min_x: float) -> list[dict]:
    return sorted(
        [
            row
            for row in rows
            if start - 4 <= row["box"][1] < end and row["box"][0] > min_x
            and not marker_for(row["text"])
        ],
        key=lambda row: (row["box"][1], row["box"][0]),
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("ocr", type=Path)
    parser.add_argument("dictionary", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--audit", type=Path, required=True)
    args = parser.parse_args()

    dictionary = load_dictionary(args.dictionary)
    records: list[dict] = []
    current: dict | None = None
    current_field: str | None = None

    for page_number in range(19, 428):
        page_path = args.ocr / f"page-{page_number:03d}.json"
        if not page_path.exists():
            continue
        page = json.loads(page_path.read_text(encoding="utf-8"))
        width, height = page["size"]
        min_x = width * 0.205
        events = headword_candidates(page, dictionary)
        for row in page["chinese"]:
            marker = marker_for(row["text"])
            if marker:
                events.append(
                    {
                        "type": "label",
                        "y": row["box"][1],
                        "field": marker[0],
                        "suffix": marker[1],
                    }
                )
        events.sort(key=lambda event: (event["y"], 0 if event["type"] == "headword" else 1))

        if not events:
            current = None
            current_field = None
            continue

        cursor = height * 0.075
        for event in events + [{"type": "end", "y": height * 0.95}]:
            end = event["y"] - (height * 0.014 if event["type"] == "headword" else 0)
            if current and current_field and end > cursor:
                source = page["chinese"] if current_field in {"meaning", "derivatives"} else page["english"]
                lines = rows_between(source, cursor, end, min_x)
                current[current_field].extend(row["text"] for row in lines)
            if event["type"] == "headword":
                current = {
                    "word": event["word"],
                    "phonetic": [],
                    "meaning": [],
                    "example": [],
                    "derivatives": [],
                    "synonyms": [],
                    "page": page_number,
                    "unit": unit_for_page(page_number),
                    "headwordConfidence": event["confidence"],
                    "inDictionary": event["in_dictionary"],
                }
                records.append(current)
                current_field = "phonetic"
            elif event["type"] == "label" and current:
                current_field = event["field"]
                if event["suffix"]:
                    current[current_field].append(event["suffix"])
                source = page["chinese"] if current_field in {"meaning", "derivatives"} else page["english"]
                leading_rows = rows_between(
                    source,
                    event["y"] - height * 0.005,
                    event["y"],
                    min_x,
                )
                current[current_field].extend(row["text"] for row in leading_rows)
            cursor = event["y"]

    cleaned = []
    for index, record in enumerate(records, 1):
        entry = dictionary.get(record["word"], {})
        phonetic = join_lines(record["phonetic"], "phonetic")
        if not phonetic or not re.search(r"[aeiouəæɔʌɑɒɜɪʊ]", phonetic, re.I):
            phonetic = entry.get("phonetic", "")
        cleaned.append(
            {
                "id": f"toefl-book-{index}",
                "word": record["word"],
                "phonetic": phonetic,
                "meaning": join_lines(record["meaning"], "meaning"),
                "example": join_lines(record["example"], "example"),
                "derivatives": join_lines(record["derivatives"], "derivatives"),
                "synonyms": join_lines(record["synonyms"], "synonyms"),
                "sourcePage": record["page"],
                "sourceUnit": record["unit"],
                "headwordConfidence": record["headwordConfidence"],
                "inDictionary": record["inDictionary"],
            }
        )

    word_counts = Counter(record["word"] for record in cleaned)
    missing = {
        field: [record["word"] for record in cleaned if not record[field]]
        for field in ["meaning", "example", "derivatives", "synonyms"]
    }
    unknown = [record for record in cleaned if not record["inDictionary"]]
    duplicates = sorted(word for word, count in word_counts.items() if count > 1)
    audit = {
        "total": len(cleaned),
        "units": dict(Counter(str(record["sourceUnit"]) for record in cleaned)),
        "unknownHeadwords": [{"word": row["word"], "page": row["sourcePage"]} for row in unknown],
        "duplicateHeadwords": duplicates,
        "missingFields": {field: {"count": len(words), "sample": words[:40]} for field, words in missing.items()},
    }
    args.output.write_text(json.dumps(cleaned, ensure_ascii=False, indent=2), encoding="utf-8")
    args.audit.write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(audit, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
