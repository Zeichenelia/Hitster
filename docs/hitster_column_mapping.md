# Hitster-DE CSV Column Mapping

This repository keeps multiple Hitster Germany deck CSVs aligned on a shared schema so they can be merged or validated automatically.

## Canonical Column Order

1. Card#
2. Title
3. Artist
4. Year
5. URL
6. Hashed Info
7. Youtube-Title
8. ISRC

Every deck should expose at least these columns. Additional metadata is allowed, yet pipelines may drop unknown fields when normalizing.

## Normalization Rules

- Trim whitespace around header names.
- Treat hyphens and spaces interchangeably (e.g., `Youtube Title` maps to `Youtube-Title`).
- Accept aliases defined in `scripts/audit_hitster_de_csvs.py` (extend the `ALIAS_MAP` dict when a new variant appears).
- Preserve the `Year` column verbatim; downstream logic relies on its exact capitalization.

## Verification Workflow

1. Place the downloaded `hitster-de*.csv` files anywhere under the repository root.
2. Run `python scripts/audit_hitster_de_csvs.py`.
3. Inspect the report:
   - `Has Year column: yes` confirms compliance.
   - `Missing canonical columns` highlights gaps to fix.
   - `Extra columns` shows deck-specific metadata that may need mapping.
4. Adjust headers and rerun the script until all files pass.

## Extending the Schema

When new columns become mandatory:
- Add them to `CANONICAL_ORDER` in `audit_hitster_de_csvs.py`.
- Update transform jobs or downstream consumers to expect the new fields.
- Document the addition in this file so teams stay synchronized.

Keeping this checklist up to date ensures each Hitster deck remains consistent and ready for ingestion.
