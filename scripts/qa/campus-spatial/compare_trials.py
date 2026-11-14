#!/usr/bin/env python3
"""Audit paired, on-device campus navigation trials before publishing comparisons.

No network calls, guessed measurements or fabricated reference locations.
A passing report checks data completeness, not ground-truth authenticity.
"""
from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from datetime import date
import json
import math
from pathlib import Path
from statistics import median

PRODUCTS = ("nuni", "google-maps", "apple-maps", "providence-official", "unitable")
FIELDS = (
    "scenario_id", "repeat", "product", "task", "school_id", "device_id",
    "os_version", "network", "setup_state", "ground_truth_ref",
    "ground_truth_date", "tested_on", "app_version", "result", "verified_target",
    "steps", "seconds", "fps", "visual_rating", "evidence_ref",
)
TASKS = {"building", "classroom", "route", "accessibility", "visual"}
RESULTS = {"success", "failure", "unverified"}
TARGETS = {"building", "classroom", "route", "ui", "not-verified"}
COHORT_FIELDS = (
    "scenario_id", "task", "school_id", "device_id", "os_version",
    "network", "setup_state", "ground_truth_ref", "ground_truth_date",
)
MIN_REPEATS = 3


def _number(value: str, label: str, *, integer: bool = False) -> float | int | None:
    if not value.strip():
        return None
    try:
        number = float(value)
    except ValueError as error:
        raise ValueError(f"{label}: invalid number") from error
    if not math.isfinite(number) or number < 0 or (integer and not number.is_integer()):
        raise ValueError(f"{label}: expected a nonnegative finite {'integer' if integer else 'number'}")
    return int(number) if integer else number


def _date(value: str, label: str) -> date:
    try:
        parsed = date.fromisoformat(value)
        if parsed.isoformat() != value:
            raise ValueError
        return parsed
    except ValueError as error:
        raise ValueError(f"{label}: expected YYYY-MM-DD") from error


def audit_rows(rows: list[dict[str, str]]) -> dict:
    """Return machine-readable findings, including incomplete/unscored cases."""
    errors: list[str] = []
    unique: set[tuple[str, str, str]] = set()
    trials: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for line, row in enumerate(rows, start=2):
        label = f"line {line}"
        if any(field not in row for field in FIELDS):
            errors.append(f"{label}: missing required CSV columns")
            continue
        # csv.DictReader uses None for a truncated record; reject rather than crash.
        row = {field: row[field] or "" for field in FIELDS}
        if any(not row[field].strip() for field in FIELDS if field not in
               {"steps", "seconds", "fps", "visual_rating", "evidence_ref"}):
            errors.append(f"{label}: missing required metadata")
            continue
        if row["product"] not in PRODUCTS or row["task"] not in TASKS:
            errors.append(f"{label}: unknown product or task")
            continue
        if row["school_id"] != "pu":
            errors.append(f"{label}: only verified Providence (pu) trials are in scope")
            continue
        if row["result"] not in RESULTS or row["verified_target"] not in TARGETS:
            errors.append(f"{label}: invalid result or verification level")
            continue
        if not row["ground_truth_ref"].startswith(("https://", "http://")):
            errors.append(f"{label}: ground truth needs an explicit source URL")
            continue
        try:
            source_date = _date(row["ground_truth_date"], f"{label} ground_truth_date")
            trial_date = _date(row["tested_on"], f"{label} tested_on")
            if source_date > trial_date:
                raise ValueError(f"{label}: ground truth cannot postdate the trial")
            repetition = _number(row["repeat"], f"{label} repeat", integer=True)
            if repetition is None or repetition < 1:
                raise ValueError(f"{label} repeat: must be at least 1")
            for key in ("steps", "seconds", "fps", "visual_rating"):
                _number(row[key], f"{label} {key}", integer=key in ("steps", "visual_rating"))
            rating = _number(row["visual_rating"], f"{label} visual_rating", integer=True)
            if rating is not None and not 1 <= rating <= 5:
                raise ValueError(f"{label} visual_rating: use 1..5 or blank")
        except ValueError as error:
            errors.append(str(error))
            continue
        key = (row["scenario_id"], str(repetition), row["product"])
        if key in unique:
            errors.append(f"{label}: duplicate scenario/repeat/product {key}")
            continue
        unique.add(key)
        # Even a reported failure needs an independently verified target;
        # otherwise we might unfairly count a competitor as wrong.
        if row["result"] != "unverified":
            expected_target = row["task"] if row["task"] in {"building", "classroom", "route"} else "ui"
            if row["verified_target"] != expected_target:
                errors.append(f"{label}: result cannot exceed verified target level for {row['task']}")
                continue
        trials[(row["scenario_id"], str(repetition))].append(row)

    grouped: dict[tuple[str, ...], dict[int, list[dict]]] = defaultdict(dict)
    pending: list[dict] = []
    for (scenario, repeat), records in sorted(trials.items()):
        reference = records[0]
        values = tuple(reference[field] for field in COHORT_FIELDS)
        reasons: list[str] = []
        present = {record["product"] for record in records}
        missing = sorted(set(PRODUCTS) - present)
        if missing:
            reasons.append("missing products: " + ", ".join(missing))
        if any(tuple(record[field] for field in COHORT_FIELDS) != values for record in records):
            reasons.append("device/scenario/conditions/ground truth are not identical")
        if len({record["tested_on"] for record in records}) != 1:
            reasons.append("paired products were tested on different dates")
        for record in records:
            if (record["result"] == "unverified" or record["verified_target"] == "not-verified"
                    or not record["evidence_ref"].strip()):
                reasons.append(f"{record['product']}: unverified result or missing evidence")
            if _number(record["steps"], "steps", integer=True) is None or _number(record["seconds"], "seconds") is None:
                reasons.append(f"{record['product']}: missing timed steps/seconds")
        if reasons:
            pending.append({"scenario_id": scenario, "repeat": int(repeat), "reasons": sorted(set(reasons))})
        else:
            grouped[values][int(repeat)] = records

    ready: list[dict] = []
    for metadata, repeats in sorted(grouped.items()):
        if len(repeats) < MIN_REPEATS:
            pending.append({"scenario_id": metadata[0], "repeats": sorted(repeats),
                            "reasons": [f"only {len(repeats)} complete repeats; need {MIN_REPEATS}"]})
            continue
        metrics = {}
        for product in PRODUCTS:
            entries = [next(record for record in batch if record["product"] == product)
                       for batch in repeats.values()]
            metrics[product] = {
                "successes": sum(record["result"] == "success" for record in entries),
                "trials": len(entries),
                "median_steps": median(int(record["steps"]) for record in entries),
                "median_seconds": median(float(record["seconds"]) for record in entries),
                "median_fps": median(float(record["fps"]) for record in entries if record["fps"].strip())
                if any(record["fps"].strip() for record in entries) else None,
                "median_visual_rating": median(int(record["visual_rating"]) for record in entries
                                               if record["visual_rating"].strip())
                if any(record["visual_rating"].strip() for record in entries) else None,
            }
        ready.append({"conditions": dict(zip(COHORT_FIELDS, metadata)),
                      "repeats": sorted(repeats), "metrics": metrics})
    return {"errors": errors, "ready": ready, "pending": pending,
            "note": "Completeness and paired conditions only; independent evidence and site verification remain required. No automatic competitor winner."}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path, help="one record per product and trial; no generated metrics")
    parser.add_argument("--output", type=Path, help="write JSON audit to a file")
    args = parser.parse_args()
    with args.csv.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames or not set(FIELDS).issubset(reader.fieldnames):
            parser.error("CSV is missing required headers: " + ", ".join(FIELDS))
        report = audit_rows(list(reader))
    payload = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(payload, encoding="utf-8")
    else:
        print(payload, end="")
    return 1 if report["errors"] else 2 if not report["ready"] or report["pending"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
