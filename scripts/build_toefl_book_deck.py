#!/usr/bin/env python3
"""Merge canonical unit lists, parsed detail pages, and dictionary fallbacks."""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter
from pathlib import Path

LIST_PAGES = {
    2: 40, 3: 61, 4: 80, 5: 97, 6: 115, 7: 132, 8: 152,
    9: 171, 10: 189, 11: 208, 12: 228, 13: 249, 15: 286,
    16: 305, 17: 325, 18: 347, 19: 368, 20: 386, 21: 407,
}
DIRECT_REPAIRS = {"magnity": "magnify", "mercilese": "merciless"}
SPLIT_REPAIRS = {
    "thesis": "photosynthesis",
    "ation": "recommendation",
    "ate": "undergraduate",
    "namics": "thermodynamics",
    "standing": "notwithstanding",
    "sense": "commonsense",
    "tive": "hypersensitive",
    "ance": "preponderance",
}
EMPTY_FRAGMENTS = {
    "photosyn-", "recommend-", "undergradu-", "thermody-", "notwith-",
    "common-", "hypersensi-", "reponder-",
}
OCR_CORRECTIONS = {
    "alll": "all", "archacology": "archaeology", "archacological": "archaeological",
    "archacologist": "archaeologist", "idcas": "ideas", "mcmbers": "members",
    "claming": "claiming", "stiflfer": "stiffer", "scicntists": "scientists",
    "powertul": "powerful", "dccades": "decades", "casy": "easy",
    "subterranen": "subterranean", "bcginning": "beginning", "uposed": "proposed",
    "castern": "eastern", "discoverics": "discoveries", "becamc": "became",
    "houschold": "household", "cighteenth": "eighteenth", "volent": "violent",
    "chiff": "cliff", "clectron": "electron", "carliest": "earliest",
    "tehave": "behave", "dcfensive": "defensive", "cxploitable": "exploitable",
    "jourey": "journey", "ncbular": "nebular", "catcgorization": "categorization",
    "cntcrprising": "enterprising", "gaently": "gently", "requisitc": "requisite",
    "catcgory": "category", "channcl": "channel", "comctic": "cometic",
    "rcgularization": "regularization", "gcographer": "geographer",
    "gcographically": "geographically", "cxceed": "exceed", "tamcless": "tameless",
    "modcrateness": "moderateness", "entreprcneurial": "entrepreneurial",
    "entreprencurship": "entrepreneurship", "ggeology": "geology",
    "gqeologist": "geologist", "carthworm": "earthworm", "sightsce": "sightsee",
    "gcomagnetism": "geomagnetism", "smokchouse": "smokehouse",
    "capabiity": "capability", "criticaliy": "critically", "gcometrical": "geometrical",
    "mancuver": "maneuver", "mancuverability": "maneuverability",
    "medicvalist": "medievalist", "palcncss": "paleness", "permancntly": "permanently",
    "shecrly": "sheerly", "uniqucly": "uniquely", "uniqucness": "uniqueness",
    "breczily": "breezily", "dcalership": "dealership", "densencss": "denseness",
    "cjective": "ejective", "cjection": "ejection", "cxemplification": "exemplification",
    "collcge": "college", "continement": "confinement", "mclodrama": "melodrama",
    "clectronic": "electronic", "ralway": "railway", "thrcatening": "threatening",
    "hygicne": "hygiene", "simultancously": "simultaneously",
    "accessibiity": "accessibility", "framcless": "frameless", "seperate": "separate",
    "deccptive": "deceptive", "instantancous": "instantaneous",
    "instantancously": "instantaneously", "tongucless": "tongueless",
    "transcendentle": "transcendently", "fantacy": "fantasy", "bargin": "bargain",
    "cthical": "ethical", "comcdy": "comedy", "comprchensively": "comprehensively",
    "connoisscurship": "connoisseurship", "faithtul": "faithful",
    "approachablity": "approachability", "accompanicd": "accompanied",
    "rbanization": "urbanization", "rcformism": "reformism", "transterable": "transferable",
    "vincgarish": "vinegarish", "vaguc": "vague", "engravc": "engrave",
    "houschold": "household", "adji": "adj.", "udj": "adj.",
    "mcagerness": "meagerness", "gqrasping": "grasping", "flectingness": "fleetingness",
    "tuncless": "tuneless", "gcaring": "gearing", "relicvable": "relievable",
    "scalant": "sealant", "hcightcn": "heighten", "gqive": "give", "adlv": "adv.",
    "casc": "case", "shelff": "shelf", "provid": "provided",
}
FIELD_OVERRIDES = {
    "acid": {"derivatives": "acidic（adj.）酸性的；acidity（n.）酸性；acidly（adv.）刻薄地"},
    "supervise": {"derivatives": "supervisor（n.）监督人，管理人；supervisorship（n.）管理人的职位"},
    "structural": {"derivatives": "structure（n. & v.）；structurally（adv.）"},
    "symptom": {"derivatives": "symptomless（adj.）没有征兆的"},
    "plantation": {"derivatives": "planter（n.）"},
    "qualify": {"derivatives": "qualified（adj.）；qualification（n.）"},
    "testify": {"derivatives": "testification（n.）；testifier（n.）"},
    "dwarf": {"derivatives": "dwarfish（adj.）比较矮小的"},
    "adorn": {"synonyms": "decorate, embellish, ornament"},
    "dealer": {"example": "In 1905 he was sent to Paris as an apprentice to an art dealer."},
    "shelf": {"example": "His laboratory at Menlo Park, New Jersey, was equipped with a rich variety of scientific instruments, and its library shelves included the latest scientific books as well as periodicals."},
    "throw": {"example": "Stinging cells in the tentacles throw out tiny poison threads that paralyze other small sea animals."},
    "steer": {"example": "Even with the Sun or stars to steer by, the problems of navigation are more complicated than they might seem at first."},
    "confederacy": {"example": "The six states holding no claim to the transmontane region doubted whether a confederacy in which territory was so unevenly apportioned would truly prove what it claimed to be, a union of equals."},
}


def load_dictionary(path: Path) -> dict[str, dict]:
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return {row["word"].lower(): row for row in csv.DictReader(stream) if row.get("word")}


def concise_translation(value: str) -> str:
    lines = [line.strip() for line in value.replace("\\n", "\n").splitlines()]
    return "；".join(line for line in lines if line and not line.startswith("[网络]") )[:220]


def correct_ocr(text: str) -> str:
    text = text.replace("magneti zed", "magnetized")
    text = text.replace("indis pensable", "indispensable")
    text = text.replace("incon gruity", "incongruity")
    text = text.replace("atmosUnit 20 pheric", "atmospheric")
    text = text.replace("armten", "arm, ten")
    text = text.replace("highwave", "highway")
    text = text.replace("nine-teenth", "nineteenth")
    text = re.sub(r"\bscended\b", "Transcended", text)
    for wrong, right in {
        "bluegreen": "blue-green", "farflung": "far-flung", "nonadapted": "non-adapted",
        "wellorganized": "well-organized", "fourteenthcentury": "fourteenth-century",
        "decisionmaking": "decision-making", "fruitbearing": "fruit-bearing",
        "oncefaint": "once-faint", "multistories": "multi-storied",
        "lefthanders": "left-handers", "sugarlike": "sugar-like",
        "selfgoverning": "self-governing", "lowfrequency": "low-frequency",
        "righthandedness": "right-handedness", "hightensile": "high-tensile",
    }.items():
        text = re.sub(rf"\b{wrong}\b", right, text, flags=re.I)
    text = re.sub(r"\[\s*\d+[^\]]*\]", " ", text)
    text = re.sub(r"\bUnit\s+\d+\b", " ", text)
    for wrong, right in OCR_CORRECTIONS.items():
        text = re.sub(rf"\b{re.escape(wrong)}\b", right, text, flags=re.I)
    return re.sub(r"\s+", " ", text).strip()


def trim_at_next(text: str, next_word: str | None) -> str:
    if not text:
        return ""
    cut = len(text)
    for pattern in [r"\bExercise of Unit\b", r"\bANSWERS:\b"]:
        match = re.search(pattern, text, re.I)
        if match:
            cut = min(cut, match.start())
    if next_word:
        match = re.search(rf"\b{re.escape(next_word)}\b", text, re.I)
        if match:
            cut = min(cut, match.start())
    return text[:cut].strip(" ;,.-")


def clean_example(text: str, word: str, next_word: str | None) -> str:
    text = trim_at_next(correct_ocr(text), next_word)
    sentences = re.split(r"(?<=[.!?])\s+", text)
    stem = word[: max(4, min(7, len(word) - 2))]
    matching = [sentence for sentence in sentences if re.search(rf"\b{re.escape(stem)}", sentence, re.I)]
    chosen = matching or sentences[:1]
    unique = []
    for sentence in chosen:
        normalized = re.sub(r"\s+", " ", sentence).strip()
        if normalized and normalized not in unique:
            unique.append(normalized)
    return " ".join(unique[:3])


def clean_detail(text: str, next_word: str | None, synonyms: bool = False) -> str:
    text = trim_at_next(correct_ocr(text), next_word)
    if synonyms:
        text = re.split(r"\[[^\]]*$|\[|\b\d+\s*[a-z]?\.", text, maxsplit=1)[0]
        text = re.sub(r"^\([^)]{1,5}\)\s*", "", text)
    return text.strip(" ;,.-")


def canonical_words(page_path: Path, dictionary: dict[str, dict]) -> list[str]:
    page = json.loads(page_path.read_text(encoding="utf-8"))
    rows = sorted(page["english"], key=lambda row: (row["box"][0], row["box"][1]))
    words = []
    for row in rows:
        text = row["text"].lower().strip()
        text = re.sub(r"\s*\([^)]*\)$", "", text)
        if re.fullmatch(r"[a-z][a-z-]{2,}", text) and text in dictionary:
            words.append(text)
    return words


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("extracted", type=Path)
    parser.add_argument("ocr", type=Path)
    parser.add_argument("dictionary", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--audit", type=Path, required=True)
    args = parser.parse_args()

    dictionary = load_dictionary(args.dictionary)
    details = json.loads(args.extracted.read_text(encoding="utf-8"))
    repaired = []
    repair_log = []
    for record in details:
        word = record["word"]
        if word in EMPTY_FRAGMENTS:
            continue
        if word in DIRECT_REPAIRS:
            repair_log.append({"from": word, "to": DIRECT_REPAIRS[word], "page": record["sourcePage"]})
            record["word"] = DIRECT_REPAIRS[word]
        elif word in SPLIT_REPAIRS:
            repair_log.append({"from": word, "to": SPLIT_REPAIRS[word], "page": record["sourcePage"]})
            record["word"] = SPLIT_REPAIRS[word]
        repaired.append(record)

    details_by_unit: dict[int, dict[str, dict]] = {}
    ordered_by_unit: dict[int, list[dict]] = {}
    for record in repaired:
        details_by_unit.setdefault(record["sourceUnit"], {})[record["word"]] = record
        ordered_by_unit.setdefault(record["sourceUnit"], []).append(record)

    final = []
    missing_detail = []
    for unit in range(1, 22):
        if unit in LIST_PAGES:
            words = canonical_words(
                args.ocr / f"page-{LIST_PAGES[unit]:03d}.json", dictionary
            )
        else:
            words = [record["word"] for record in ordered_by_unit.get(unit, [])]

        for word in words:
            record = details_by_unit.get(unit, {}).get(word)
            entry = dictionary.get(word, {})
            if record:
                detail_status = "complete"
                meaning = record["meaning"] or concise_translation(entry.get("translation", ""))
            else:
                detail_status = "source-page-missing"
                missing_detail.append({"word": word, "unit": unit})
                meaning = concise_translation(entry.get("translation", ""))
            final.append(
                {
                    "id": f"toefl-book-{len(final) + 1}",
                    "word": word,
                    "phonetic": (record or {}).get("phonetic") or entry.get("phonetic", ""),
                    "meaning": meaning,
                    "example": (record or {}).get("example", ""),
                    "translation": "",
                    "derivatives": (record or {}).get("derivatives", ""),
                    "synonyms": (record or {}).get("synonyms", ""),
                    "sourcePage": (record or {}).get("sourcePage"),
                    "sourceUnit": unit,
                    "sourceDetailStatus": detail_status,
                    "day": 1,
                }
            )

    for index, row in enumerate(final):
        next_word = (
            final[index + 1]["word"]
            if index + 1 < len(final) and final[index + 1]["sourceUnit"] == row["sourceUnit"]
            else None
        )
        row["example"] = clean_example(row["example"], row["word"], next_word)
        row["derivatives"] = clean_detail(row["derivatives"], next_word)
        row["synonyms"] = clean_detail(row["synonyms"], next_word, synonyms=True)
        for field, value in FIELD_OVERRIDES.get(row["word"], {}).items():
            row[field] = value
        if row["sourceDetailStatus"] == "complete" and not row["example"]:
            row["sourceDetailStatus"] = "partial-source"

    best_by_word = {}
    for row in final:
        existing = best_by_word.get(row["word"])
        if not existing or (
            existing["sourceDetailStatus"] != "complete"
            and row["sourceDetailStatus"] == "complete"
        ):
            best_by_word[row["word"]] = row
    final = [row for row in final if best_by_word[row["word"]] is row]
    for index, row in enumerate(final, 1):
        row["id"] = f"toefl-book-{index}"

    duplicates = [word for word, count in Counter(row["word"] for row in final).items() if count > 1]
    audit = {
        "total": len(final),
        "completeDetails": sum(row["sourceDetailStatus"] == "complete" for row in final),
        "partialDetails": sum(row["sourceDetailStatus"] == "partial-source" for row in final),
        "sourcePageMissing": sum(row["sourceDetailStatus"] == "source-page-missing" for row in final),
        "byUnit": dict(Counter(str(row["sourceUnit"]) for row in final)),
        "repairs": repair_log,
        "duplicates": duplicates,
        "missingDetailSample": missing_detail[:80],
    }
    args.output.write_text(json.dumps(final, ensure_ascii=False, indent=2), encoding="utf-8")
    args.audit.write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(audit, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
