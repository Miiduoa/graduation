"""Synthetic audit regression cases: these are not observed campus measurements."""
import unittest

from compare_trials import PRODUCTS, _valid_headers, audit_rows


def row(product="nuni", repeat=1, **changes):
    sample = {
        "scenario_id": "synthetic-building-01", "repeat": str(repeat), "product": product,
        "task": "building", "school_id": "pu", "device_id": "iphone-test-01",
        "os_version": "iOS-test", "network": "wifi", "setup_state": "daily-use",
        "ground_truth_ref": "https://example.org/fictitious", "ground_truth_date": "2026-11-14",
        "tested_on": "2026-11-14", "app_version": "test-build", "result": "success",
        "verified_target": "building", "steps": "4", "seconds": "12.5", "fps": "",
        "visual_rating": "", "evidence_ref": "synthetic-artifact",
    }
    sample.update(changes)
    return sample


def complete(repeats=3):
    return [row(product, repeat) for repeat in range(1, repeats + 1) for product in PRODUCTS]


class AuditTrialsTests(unittest.TestCase):
    def test_complete_paired_cohort_has_no_unearned_winner(self):
        result = audit_rows(complete())
        self.assertEqual(result["errors"], [])
        self.assertEqual(result["pending"], [])
        self.assertEqual(len(result["ready"]), 1)
        self.assertEqual(result["ready"][0]["metrics"]["nuni"]["median_seconds"], 12.5)
        self.assertEqual(result["ready"][0]["app_versions"],
                         {product: "test-build" for product in PRODUCTS})
        self.assertNotIn("winner", result["ready"][0])

    def test_stable_distinct_product_versions_are_reported(self):
        records = complete()
        for entry in records:
            entry["app_version"] = entry["product"] + "-v1"
        report = audit_rows(records)
        self.assertEqual(report["errors"], [])
        self.assertEqual(report["pending"], [])
        self.assertEqual(report["ready"][0]["app_versions"],
                         {product: product + "-v1" for product in PRODUCTS})

    def test_version_drift_in_any_product_blocks_cohort_metrics(self):
        for product in PRODUCTS:
            with self.subTest(product=product):
                records = complete()
                next(entry for entry in records if entry["product"] == product
                     and entry["repeat"] == "2")["app_version"] = "updated-build"
                report = audit_rows(records)
                self.assertEqual(report["errors"], [])
                self.assertEqual(report["ready"], [])
                self.assertTrue(any("mixed-version metrics" in str(item)
                                    and product in str(item)
                                    for item in report["pending"]))

    def test_version_drift_in_fourth_repeat_cannot_be_cherry_picked(self):
        records = complete(4)
        records[-1]["app_version"] = "updated-build"
        independent = [dict(entry, scenario_id="synthetic-building-02") for entry in complete()]
        report = audit_rows(records + independent)
        self.assertEqual(report["errors"], [])
        self.assertEqual(len(report["ready"]), 1)
        self.assertEqual(report["ready"][0]["conditions"]["scenario_id"], "synthetic-building-02")
        self.assertTrue(any(item.get("repeats") == [1, 2, 3, 4]
                            and "mixed-version metrics" in str(item) for item in report["pending"]))

    def test_complete_fourth_repeat_with_condition_drift_blocks_partial_metrics(self):
        for field, value in (
            ("device_id", "other-iphone"), ("os_version", "other-os"),
            ("network", "cellular"), ("setup_state", "fresh-install"),
            ("ground_truth_ref", "https://example.org/other"),
            ("ground_truth_date", "2026-11-13"),
        ):
            with self.subTest(field=field):
                records = complete(4)
                for entry in records:
                    if entry["repeat"] == "4":
                        entry[field] = value
                independent = [dict(entry, scenario_id="synthetic-building-02")
                               for entry in complete()]
                report = audit_rows(records + independent)
                self.assertEqual(report["errors"], [])
                self.assertEqual(len(report["ready"]), 1)
                self.assertEqual(report["ready"][0]["conditions"]["scenario_id"],
                                 "synthetic-building-02")
                self.assertTrue(any("conditions changed across repeats" in str(item)
                                    for item in report["pending"]))

    def test_two_complete_cohorts_cannot_share_one_scenario_id(self):
        records = complete(6)
        for entry in records:
            if int(entry["repeat"]) > 3:
                entry.update(task="classroom", verified_target="classroom")
        report = audit_rows(records)
        self.assertEqual(report["errors"], [])
        self.assertEqual(report["ready"], [])
        self.assertEqual(len(report["pending"]), 2)

    def test_missing_competitor_cannot_be_reported_as_complete(self):
        records = [entry for entry in complete() if not (entry["product"] == "apple-maps" and entry["repeat"] == "1")]
        result = audit_rows(records)
        self.assertTrue(result["pending"])
        self.assertTrue(any("apple-maps" in repr(item) for item in result["pending"]))

    def test_device_mismatch_is_flagged(self):
        records = complete()
        records[0]["device_id"] = "other-iphone"
        self.assertTrue(any("not identical" in repr(item) for item in audit_rows(records)["pending"]))

    def test_ground_truth_dated_after_trial_cannot_verify_result(self):
        records = complete()
        records[0]["tested_on"] = "2026-11-13"
        result = audit_rows(records)
        self.assertTrue(any("ground truth cannot postdate" in err for err in result["errors"]))
        self.assertEqual(result["ready"], [])

    def test_different_test_dates_are_not_a_paired_repeat(self):
        records = complete()
        for entry in records:
            entry["ground_truth_date"] = "2026-11-09"
        records[0]["tested_on"] = "2026-11-10"
        result = audit_rows(records)
        self.assertEqual(result["errors"], [])
        self.assertEqual(result["ready"], [])
        self.assertTrue(any("different dates" in str(item) for item in result["pending"]))

    def test_partial_fps_or_visual_ratings_never_create_unpaired_medians(self):
        records = complete()
        for entry in records:
            entry.update(fps="60", visual_rating="4")
        records[0]["fps"] = ""
        records[1]["visual_rating"] = ""
        report = audit_rows(records)
        self.assertEqual(report["errors"], [])
        self.assertEqual(report["pending"], [])
        cohort = report["ready"][0]
        self.assertEqual(cohort["paired_optional_metrics"], {"fps": False, "visual_rating": False})
        for product in PRODUCTS:
            self.assertIsNone(cohort["metrics"][product]["median_fps"])
            self.assertIsNone(cohort["metrics"][product]["median_visual_rating"])
            self.assertEqual(cohort["metrics"][product]["median_seconds"], 12.5)

    def test_fully_paired_optional_metrics_can_be_reported(self):
        records = complete()
        for entry in records:
            entry.update(fps="48.5", visual_rating="3")
        cohort = audit_rows(records)["ready"][0]
        self.assertEqual(cohort["paired_optional_metrics"], {"fps": True, "visual_rating": True})
        for product in PRODUCTS:
            self.assertEqual(cohort["metrics"][product]["median_fps"], 48.5)
            self.assertEqual(cohort["metrics"][product]["median_visual_rating"], 3)

    def test_zero_second_trial_cannot_create_impossible_fastest_result(self):
        records = complete()
        records[0]["seconds"] = "0"
        report = audit_rows(records)
        self.assertTrue(any("greater than zero" in err for err in report["errors"]))
        self.assertEqual(report["ready"], [])


    def test_incomplete_fourth_repeat_cannot_be_cherry_picked_from_three_valid_repeats(self):
        records = [entry for entry in complete(4)
                   if not (entry["product"] == "apple-maps" and entry["repeat"] == "4")]
        report = audit_rows(records)
        self.assertEqual(report["errors"], [])
        self.assertEqual(report["ready"], [])
        self.assertTrue(any("missing products" in str(item) for item in report["pending"]))
        self.assertTrue(any("no partial-cohort metrics" in str(item) for item in report["pending"]))

    def test_invalid_fourth_repeat_does_not_leave_misleading_ready_metrics(self):
        records = complete(4)
        records[-1]["seconds"] = "0"
        report = audit_rows(records)
        self.assertEqual(report["ready"], [])
        self.assertTrue(any("greater than zero" in error for error in report["errors"]))
        self.assertTrue(any("no partial-cohort metrics" in str(item) for item in report["pending"]))

    def test_incomplete_scenario_does_not_block_a_fully_paired_other_scenario(self):
        records = complete(4)
        records[-1]["evidence_ref"] = ""
        independent = [dict(entry, scenario_id="synthetic-building-02") for entry in complete()]
        report = audit_rows(records + independent)
        self.assertEqual(report["errors"], [])
        self.assertEqual(len(report["ready"]), 1)
        self.assertEqual(report["ready"][0]["conditions"]["scenario_id"], "synthetic-building-02")

    def test_surplus_csv_cells_cannot_be_silently_ignored(self):
        records = complete()
        # csv.DictReader stores extra cells under a None key.
        records[0][None] = ["hidden-shifted-evidence"]
        report = audit_rows(records)
        self.assertEqual(report["ready"], [])
        self.assertTrue(any("surplus cells" in error for error in report["errors"]))

    def test_unexpected_csv_fields_block_publishing(self):
        records = complete()
        records[0]["unreviewed_score"] = "5"
        report = audit_rows(records)
        self.assertEqual(report["ready"], [])
        self.assertTrue(any("unexpected CSV fields" in error for error in report["errors"]))

    def test_duplicate_or_extra_headers_are_rejected(self):
        from compare_trials import FIELDS
        self.assertTrue(_valid_headers(list(FIELDS)))
        self.assertFalse(_valid_headers(list(FIELDS) + ["evidence_ref"]))
        self.assertFalse(_valid_headers(list(FIELDS) + ["unreviewed_score"]))
        self.assertFalse(_valid_headers(list(FIELDS[:-1]) + ["result"]))
        self.assertFalse(_valid_headers(None))

    def test_distinct_large_integer_repeat_ids_do_not_collapse_via_float(self):
        records = complete()
        for entry in records:
            entry["repeat"] = str(9007199254740991 + int(entry["repeat"]))
        report = audit_rows(records)
        self.assertEqual(report["errors"], [])
        self.assertEqual(report["pending"], [])
        self.assertEqual(len(report["ready"]), 1)
        self.assertEqual(report["ready"][0]["repeats"],
                         [9007199254740992, 9007199254740993, 9007199254740994])

    def test_fractional_or_scientific_repeat_tokens_are_rejected(self):
        for token in ("1.0", "1e0", "-1"):
            with self.subTest(token=token):
                records = complete()
                records[0]["repeat"] = token
                report = audit_rows(records)
                self.assertEqual(report["ready"], [])
                self.assertTrue(any("expected a nonnegative integer" in error
                                    for error in report["errors"]))

    def test_failed_attempts_do_not_win_on_fast_failure(self):
        records = complete()
        for entry in records:
            if entry["product"] == "google-maps":
                entry.update(result="failure", steps="2", seconds="1")
        completed_trial = next(entry for entry in records
                               if entry["product"] == "google-maps" and entry["repeat"] == "1")
        completed_trial.update(result="success", steps="7", seconds="80")
        report = audit_rows(records)
        self.assertEqual(report["errors"], [])
        self.assertEqual(report["pending"], [])
        metrics = report["ready"][0]["metrics"]["google-maps"]
        self.assertEqual(metrics["successes"], 1)
        self.assertEqual(metrics["trials"], 3)
        self.assertEqual(metrics["median_steps"], 7)
        self.assertEqual(metrics["median_seconds"], 80)
        self.assertEqual(metrics["median_attempt_steps"], 2)
        self.assertEqual(metrics["median_attempt_seconds"], 1)

    def test_zero_successes_has_no_fictitious_completion_time(self):
        records = complete()
        for entry in records:
            if entry["product"] == "apple-maps":
                entry["result"] = "failure"
        report = audit_rows(records)
        self.assertEqual(report["errors"], [])
        self.assertEqual(report["pending"], [])
        metrics = report["ready"][0]["metrics"]["apple-maps"]
        self.assertEqual(metrics["successes"], 0)
        self.assertEqual(metrics["trials"], 3)
        self.assertIsNone(metrics["median_steps"])
        self.assertIsNone(metrics["median_seconds"])
        self.assertEqual(metrics["median_attempt_steps"], 4)
        self.assertEqual(metrics["median_attempt_seconds"], 12.5)

    def test_pending_when_only_two_repeats(self):
        result = audit_rows(complete(2))
        self.assertEqual(result["ready"], [])
        self.assertTrue(any("need 3" in repr(item) for item in result["pending"]))

    def test_missing_time_and_evidence_prevents_scoring(self):
        records = complete()
        records[0].update(seconds="", evidence_ref="")
        self.assertTrue(audit_rows(records)["pending"])

    def test_unknown_target_cannot_be_misreported_as_building_success(self):
        records = complete()
        records[0]["verified_target"] = "not-verified"
        self.assertTrue(any("cannot exceed" in err for err in audit_rows(records)["errors"]))

    def test_duplicate_trial_is_rejected(self):
        records = complete()
        records.append(dict(records[0]))
        self.assertTrue(any("duplicate" in err for err in audit_rows(records)["errors"]))

    def test_invalid_numeric_and_dates_are_rejected(self):
        for mutation in ({"seconds": "nan"}, {"steps": "-1"}, {"visual_rating": "8"},
                         {"tested_on": "2026-13-50"}):
            with self.subTest(mutation=mutation):
                records = complete()
                records[0].update(mutation)
                self.assertTrue(audit_rows(records)["errors"])

    def test_truncated_record_is_rejected_without_crashing(self):
        records = complete()
        records[0]["result"] = None
        self.assertTrue(audit_rows(records)["errors"])

    def test_classroom_success_requires_classroom_verification(self):
        records = complete()
        records[0].update(task="classroom", verified_target="building")
        self.assertTrue(any("cannot exceed" in err for err in audit_rows(records)["errors"]))


    def test_failed_classroom_with_only_building_evidence_cannot_penalize_competitor(self):
        records = complete()
        records[0].update(task="classroom", result="failure", verified_target="building")
        self.assertTrue(any("cannot exceed" in err for err in audit_rows(records)["errors"]))

    def test_ui_task_uses_separate_evidence_level(self):
        records = complete()
        for entry in records:
            entry.update(task="accessibility", verified_target="ui")
        self.assertEqual(len(audit_rows(records)["ready"]), 1)

    def test_visual_success_cannot_use_building_verification_instead(self):
        records = complete()
        records[0].update(task="visual", verified_target="building")
        self.assertTrue(any("cannot exceed" in err for err in audit_rows(records)["errors"]))


if __name__ == "__main__":
    unittest.main()
