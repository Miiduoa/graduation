"""Synthetic audit regression cases: these are not observed campus measurements."""
import unittest

from compare_trials import PRODUCTS, audit_rows


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
        self.assertNotIn("winner", result["ready"][0])

    def test_missing_competitor_cannot_be_reported_as_complete(self):
        records = [entry for entry in complete() if not (entry["product"] == "apple-maps" and entry["repeat"] == "1")]
        result = audit_rows(records)
        self.assertTrue(result["pending"])
        self.assertTrue(any("apple-maps" in repr(item) for item in result["pending"]))

    def test_device_mismatch_is_flagged(self):
        records = complete()
        records[0]["device_id"] = "other-iphone"
        self.assertTrue(any("not identical" in repr(item) for item in audit_rows(records)["pending"]))

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
        self.assertTrue(any("duplicate" in err for err in audit_rows(records)["errors"])

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


if __name__ == "__main__":
    unittest.main()
