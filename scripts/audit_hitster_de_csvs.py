from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import List, Sequence

CANONICAL_ORDER: Sequence[str] = (
    "Card#",
    "Title",
    "Artist",
    "Year",
    "URL",
    "Hashed Info",
    "Youtube-Title",
    "ISRC",
)

# Normalization collapses spacing/punctuation so variants still map to the canonical names.
ALIAS_MAP = {
    "card#": "Card#",
    "cardnumber": "Card#",
    "cardno": "Card#",
    "card": "Card#",
    "title": "Title",
    "artist": "Artist",
    "year": "Year",
    "url": "URL",
    "hashedinfo": "Hashed Info",
    "hashinfo": "Hashed Info",
    "youtube-title": "Youtube-Title",
    "youtubetitle": "Youtube-Title",
    "youtube": "Youtube-Title",
    "isrc": "ISRC",
}


@dataclass
class AuditResult:
    path: Path
    columns: List[str]
    normalized: List[str]

    @property
    def has_year(self) -> bool:
        return "Year" in self.normalized

    @property
    def missing_canonical(self) -> List[str]:
        return [col for col in CANONICAL_ORDER if col not in self.normalized]

    @property
    def extra_columns(self) -> List[str]:
        return [col for col in self.normalized if col not in CANONICAL_ORDER]


def normalize(column: str) -> str:
    key = column.strip().lower().replace(" ", "").replace("-", "")
    return ALIAS_MAP.get(key, column.strip())


def audit_file(path: Path) -> AuditResult | None:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        try:
            header = next(reader)
        except StopIteration:
            return None
    normalized = [normalize(col) for col in header]
    return AuditResult(path=path, columns=header, normalized=normalized)


def discover_csvs(root: Path) -> List[Path]:
    return sorted(root.rglob("hitster-de*.csv"))


def format_result(result: AuditResult) -> str:
    relative_path = result.path.relative_to(Path.cwd())
    pieces = [f"File: {relative_path}"]
    pieces.append("  Columns: " + ", ".join(result.columns))
    pieces.append(f"  Has Year column: {'yes' if result.has_year else 'no'}")
    if result.missing_canonical:
        pieces.append("  Missing canonical columns: " + ", ".join(result.missing_canonical))
    if result.extra_columns:
        pieces.append("  Extra columns: " + ", ".join(result.extra_columns))
    return "\n".join(pieces)


def main() -> int:
    root = Path.cwd()
    csv_files = discover_csvs(root)
    if not csv_files:
        print("No hitster-de*.csv files were found under", root)
        print("Add the decks and re-run this script to verify column mappings.")
        return 0

    print(f"Found {len(csv_files)} hitster-de CSV file(s).\n")
    for csv_path in csv_files:
        result = audit_file(csv_path)
        if result is None:
            print(f"File: {csv_path} is empty; skipping.")
            continue
        print(format_result(result))
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
