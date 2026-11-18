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
import re
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
    token = value.strip()
    if not token:
        return None
    if integer:
        # float() rounds distinct large repeat IDs and can silently merge trials.
        # Accept decimal integer tokens exactly; do not accept 1.0 or 1e0.
        if not re.fullmatch(r"[0-9]+", token):
            raise ValueError(f"{label}: expected a nonnegative integer")
        try:
            return int(token)
        except ValueError as error:
            raise ValueError(f"{label}: invalid integer") from error
    try:
        number = float(token)
    except ValueError as error:
        raise ValueError(f"{label}: invalid number") from error
    if not math.isfinite(number) or number < 0:
        raise ValueError(f"{label}: expected a nonnegative finite number")
    return number


def _valid_headers(fieldnames: list[str] | None) -> bool:
    # DictReader silently overwrites duplicate names and stores surplus values
    # under a None key. Both can conceal corrupted or shifted evidence columns.
    return fieldnames is not None and len(fieldnames) == len(FIELDS) and set(fieldnames) == set(FIELDS)


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
    invalid_scenarios: set[str] = set()

    def reject(row: dict, reason: str) -> None:
        errors.append(reason)
        scenario = row.get("scenario_id")
        if isinstance(scenario, str) and scenario.strip():
            invalid_scenarios.add(scenario)

    unique: set[tuple[str, str, str]] = set()
    trials: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for line, row in enumerate(rows, start=2):
        label = f"line {line}"
        if any(field not in row for field in FIELDS):
            reject(row, f"{label}: missing required CSV columns")
            continue
        if any(field not in FIELDS for field in row):
            reject(row, f"{label}: unexpected CSV fields or surplus cells")
            continue
        # csv.DictReader uses None for a truncated record; reject rather than crash.
        row = {field: row[field] or "" for field in FIELDS}
        if any(not row[field].strip() for field in FIELDS if field not in
               {"steps", "seconds", "fps", "visual_rating", "evidence_ref"}):
            reject(row, f"{label}: missing required metadata")
            continue
        if row["product"] not in PRODUCTS or row["task"] not in TASKS:
            reject(row, f"{label}: unknown product or task")
            continue
        if row["school_id"] != "pu":
            reject(row, f"{label}: only verified Providence (pu) trials are in scope")
            continue
        if row["result"] not in RESULTS or row["verified_target"] not in TARGETS:
            reject(row, f"{label}: invalid result or verification level")
            continue
        if not row["ground_truth_ref"].startswith(("https://", "http://")):
            reject(row, f"{label}: ground truth needs an explicit source URL")
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
                observed = _number(row[key], f"{label} {key}", integer=key in ("steps", "visual_rating"))
                if key == "seconds" and observed == 0:
                    raise ValueError(f"{label} seconds: recorded duration must be greater than zero")
            rating = _number(row["visual_rating"], f"{label} visual_rating", integer=True)
            if rating is not None and not 1 <= rating <= 5:
                raise ValueError(f"{label} visual_rating: use 1..5 or blank")
        except ValueError as error:
            reject(row, str(error))
            continue
        key = (row["scenario_id"], str(repetition), row["product"])
        if key in unique:
            reject(row, f"{label}: duplicate scenario/repeat/product {key}")
            continue
        unique.add(key)
        # Even a reported failure needs an independently verified target;
        # otherwise we might unfairly count a competitor as wrong.
        if row["result"] != "unverified":
            expected_target = row["task"] if row["task"] in {"building", "classroom", "route"} else "ui"
            if row["verified_target"] != expected_target:
                reject(row, f"{label}: result cannot exceed verified target level for {row['task']}")
                continue
        trials[(row["scenario_id"], str(repetition))].append(row)

    grouped: dict[tuple[str, ...], dict[int, list[dict]]] = defaultdict(dict)
    pending: list[dict] = []
    blocked_scenarios = set(invalid_scenarios)
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
            blocked_scenarios.add(scenario)
            pending.append({"scenario_id": scenario, "repeat": int(repeat), "reasons": sorted(set(reasons))})
        else:
            grouped[values][int(repeat)] = records

    ready: list[dict] = []
    for metadata, repeats in sorted(grouped.items()):
        if metadata[0] in blocked_scenarios:
            # Incomplete/invalid later repeats cannot be omitted just because
            # an earlier subset already passed the minimum sample count.
            pending.append({"scenario_id": metadata[0], "repeats": sorted(repeats),
                            "reasons": ["another repeat in this scenario is incomplete or invalid; no partial-cohort metrics"]})
            continue
        if len(repeats) < MIN_REPEATS:
            pending.append({"scenario_id": metadata[0], "repeats": sorted(repeats),
                            "reasons": [f"only {len(repeats)} complete repeats; need {MIN_REPEATS}"]})
            continue
        # Performance and visual medians are comparable only when every product
        # has measured the metric in every repeat; do not cherry-pick samples.
        paired_fps = all(entry["fps"].strip() for batch in repeats.values() for entry in batch)
        paired_visual = all(entry["visual_rating"].strip() for batch in repeats.values() for entry in batch)
        metrics = {}
        for product in PRODUCTS:
            entries = [next(record for record in batch if record["product"] == product)
                       for batch in repeats.values()]
            # A fast failure is not a fast completion. Keep failure attempts in
            # the success rate and diagnostics, not time-to-success statistics.
            completed = [record for record in entries if record["result"] == "success"]
            metrics[product] = {
                "successes": len(completed),
                "trials": len(entries),
                "median_steps": median(int(record["steps"]) for record in completed) if completed else None,
                "median_seconds": median(float(record["seconds"]) for record in completed) if completed else None,
                "median_attempt_steps": median(int(record["steps"]) for record in entries),
                "median_attempt_seconds": median(float(record["seconds"]) for record in entries),
                "median_fps": median(float(record["fps"]) for record in entries) if paired_fps else None,
                "median_visual_rating": median(int(record["visual_rating"]) for record in entries)
                if paired_visual else None,
            }
        ready.append({"conditions": dict(zip(COHORT_FIELDS, metadata)),
                      "repeats": sorted(repeats),
                      "paired_optional_metrics": {"fps": paired_fps, "visual_rating": paired_visual},
                      "metrics": metrics})
    return {"errors": errors, "ready": ready, "pending": pending,
            "note": "Completeness and paired conditions only; independent evidence and site verification remain required. No automatic competitor winner."}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path, help="one record per product and trial; no generated metrics")
    parser.add_argument("--output", type=Path, help="write JSON audit to a file")
    args = parser.parse_args()
    with args.csv.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if not _valid_headers(reader.fieldnames):
            parser.error("CSV requires each header exactly once: " + ", ".join(FIELDS))
        report = audit_rows(list(reader))
    payload = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(payload, encoding="utf-8")
    else:
        print(payload, end="")
    return 1 if report["errors"] else 2 if not report["ready"] or report["pending"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
