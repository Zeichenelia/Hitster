#!/usr/bin/env python3
"""Inspect Songseeker dataset files for release-year information.

Usage:
  python scripts/check_songseeker_years.py /path/to/songseeker
"""
from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

YEAR_RE = re.compile(r"(?:19|20)\d{2}")
CANDIDATE_KEYS = {
    "year",
    "release_year",
    "releaseyear",
    "release_date",
    "releasedate",
    "published",
    "published_at",
    "date",
    "upload_date",
}


def looks_like_year(value: object) -> bool:
    if value is None:
        return False
    s = str(value).strip()
    if not s:
        return False
    if YEAR_RE.fullmatch(s):
        return True
    return bool(YEAR_RE.search(s))


def iter_data_files(root: Path) -> Iterable[Path]:
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() in {".json", ".jsonl", ".csv"}:
            yield path


def inspect_json(path: Path) -> Tuple[int, int, Counter]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, dict):
        rows = data.get("songs") if isinstance(data.get("songs"), list) else [data]
    elif isinstance(data, list):
        rows = data
    else:
        return 0, 0, Counter()

    return inspect_rows(rows)


def inspect_jsonl(path: Path) -> Tuple[int, int, Counter]:
    rows = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            rows.append(obj)
    return inspect_rows(rows)


def inspect_csv(path: Path) -> Tuple[int, int, Counter]:
    with path.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    return inspect_rows(rows)


def inspect_rows(rows: List[dict]) -> Tuple[int, int, Counter]:
    total = 0
    with_year = 0
    key_hits: Counter = Counter()

    for row in rows:
        if not isinstance(row, dict):
            continue
        total += 1
        found = False
        for k, v in row.items():
            k_norm = str(k).strip().lower()
            if k_norm in CANDIDATE_KEYS or "year" in k_norm or "date" in k_norm:
                if looks_like_year(v):
                    key_hits[k_norm] += 1
                    found = True
        if not found:
            # fallback: any field containing year-looking value
            for k, v in row.items():
                if looks_like_year(v):
                    key_hits[str(k).strip().lower()] += 1
                    found = True
                    break
        if found:
            with_year += 1

    return total, with_year, key_hits


def inspect_file(path: Path) -> Tuple[int, int, Counter]:
    suffix = path.suffix.lower()
    if suffix == ".json":
        return inspect_json(path)
    if suffix == ".jsonl":
        return inspect_jsonl(path)
    if suffix == ".csv":
        return inspect_csv(path)
    return 0, 0, Counter()


def main() -> int:
    parser = argparse.ArgumentParser(description="Check if Songseeker data contains release years")
    parser.add_argument("dataset_root", type=Path, help="Path to local songseeker repository or exported dataset")
    args = parser.parse_args()

    root = args.dataset_root
    if not root.exists():
        raise SystemExit(f"Path not found: {root}")

    totals: Dict[Path, Tuple[int, int, Counter]] = {}
    grand_total = 0
    grand_with_year = 0
    merged_keys: Counter = Counter()

    for file in iter_data_files(root):
        total, with_year, keys = inspect_file(file)
        if total == 0:
            continue
        totals[file] = (total, with_year, keys)
        grand_total += total
        grand_with_year += with_year
        merged_keys.update(keys)

    if not totals:
        print("No JSON/JSONL/CSV song data files found.")
        return 1

    print("=== Songseeker year-field inspection ===")
    for file, (total, with_year, keys) in sorted(totals.items()):
        pct = (with_year / total * 100) if total else 0.0
        top = ", ".join(f"{k}:{v}" for k, v in keys.most_common(5)) or "-"
        print(f"{file}: rows={total}, rows_with_year={with_year} ({pct:.1f}%), top_fields={top}")

    pct = (grand_with_year / grand_total * 100) if grand_total else 0.0
    print("---")
    print(f"TOTAL rows={grand_total}, rows_with_year={grand_with_year} ({pct:.1f}%)")
    print("Most common year-related fields:", ", ".join(f"{k}:{v}" for k, v in merged_keys.most_common(10)))

    if grand_with_year == 0:
        print("Result: No usable year values detected.")
        return 2

    print("Result: Year values are present and can be queried directly (field names above).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
