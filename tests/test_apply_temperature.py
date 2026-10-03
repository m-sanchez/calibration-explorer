import copy
import csv
import hashlib
import importlib.util
import json
import math
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "apply_temperature.py"
SPEC = importlib.util.spec_from_file_location("apply_temperature", SCRIPT)
HELPER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HELPER)


def encoded(value):
    return json.dumps(value, allow_nan=False).encode("utf-8")


def fixture(rows=None, temperature=2.0):
    source = {
        "schemaVersion": 1,
        "name": "Fixture",
        "classes": ["negative", "positive"],
        "rows": rows or [{"id": "one", "split": "test", "logits": [math.log(9), 0], "label": 0}],
    }
    raw = encoded(source)
    report = {
        "schemaVersion": 1,
        "data": {"kind": "logits", "sha256": hashlib.sha256(raw).hexdigest(), "rowCount": len(source["rows"]), "classes": source["classes"]},
        "configuration": {"temperature": temperature},
        "fit": {"temperature": temperature, "status": "converged"},
    }
    return report, raw


class ApplyTemperatureTests(unittest.TestCase):
    def test_known_temperature_changes_confidence_without_changing_class(self):
        report, raw = fixture()
        result = HELPER.apply_temperature(encoded(report), raw)
        row = result["rows"][0]
        self.assertAlmostEqual(row["confidenceOriginal"], 0.9)
        self.assertAlmostEqual(row["confidenceScaled"], 0.75)
        self.assertEqual(row["predictedClass"], 0)
        self.assertEqual(row["predictedLabel"], "negative")
        self.assertTrue(row["correct"])
        self.assertEqual(result["inputSha256"], report["data"]["sha256"])

    def test_raw_argmax_survives_probability_rounding_and_exact_ties(self):
        rows = [
            {"id": "tiny", "split": "test", "logits": [0, math.ulp(0.0)], "label": 1},
            {"id": "tie", "split": "test", "logits": [2, 2], "label": 0},
        ]
        report, raw = fixture(rows, sys.float_info.max)
        result = HELPER.apply_temperature(encoded(report), raw)
        self.assertEqual([row["predictedClass"] for row in result["rows"]], [1, 0])
        self.assertEqual([row["confidenceScaled"] for row in result["rows"]], [0.5, 0.5])

    def test_centering_handles_extreme_finite_logits_and_temperatures(self):
        rows = [{"id": "extreme", "split": "test", "logits": [-1e308, 1e308], "label": 1}]
        report, raw = fixture(rows, 1e308)
        row = HELPER.apply_temperature(encoded(report), raw)["rows"][0]
        self.assertEqual(row["confidenceOriginal"], 1.0)
        self.assertAlmostEqual(row["confidenceScaled"], 1 / (1 + math.exp(-2)))
        report["fit"]["temperature"] = report["configuration"]["temperature"] = math.ulp(0.0)
        self.assertEqual(HELPER.apply_temperature(encoded(report), raw)["rows"][0]["confidenceScaled"], 1.0)

    def test_hash_class_order_and_dimension_mismatches_are_rejected(self):
        report, raw = fixture()
        with self.assertRaisesRegex(ValueError, "SHA-256 does not match"):
            HELPER.apply_temperature(encoded(report), raw + b"\n")
        changed = copy.deepcopy(report)
        changed["data"]["classes"].reverse()
        with self.assertRaisesRegex(ValueError, "class ordering"):
            HELPER.apply_temperature(encoded(changed), raw)
        rows = [{"id": "wrong", "split": "test", "logits": [0, 1, 2], "label": 1}]
        changed, source = fixture(rows)
        with self.assertRaisesRegex(ValueError, "expected 2"):
            HELPER.apply_temperature(encoded(changed), source)

    def test_invalid_or_unfitted_temperatures_are_rejected(self):
        report, raw = fixture()
        for value in [0, -1, True, "2"]:
            with self.subTest(value=value):
                changed = copy.deepcopy(report)
                changed["fit"]["temperature"] = value
                with self.assertRaises(ValueError):
                    HELPER.apply_temperature(encoded(changed), raw)
        changed = copy.deepcopy(report)
        changed["configuration"]["temperature"] = 1
        with self.assertRaisesRegex(ValueError, "does not match the saved fitted"):
            HELPER.apply_temperature(encoded(changed), raw)
        changed["fit"] = None
        with self.assertRaisesRegex(ValueError, "saved fitted temperature"):
            HELPER.apply_temperature(encoded(changed), raw)
        with self.assertRaisesRegex(ValueError, "Nonfinite JSON"):
            HELPER.apply_temperature(encoded(report).replace(b'"temperature": 2.0', b'"temperature": Infinity', 1), raw)

    def test_split_selection_never_fits_and_validates_excluded_rows(self):
        rows = [
            {"id": "fit", "split": "calibration", "logits": [100, -100], "label": 1},
            {"id": "heldout", "split": "test", "logits": [math.log(9), 0], "label": 0},
        ]
        report, raw = fixture(rows)
        result = HELPER.apply_temperature(encoded(report), raw, "test")
        self.assertEqual([row["id"] for row in result["rows"]], ["heldout"])
        self.assertEqual(result["temperature"], 2)
        self.assertAlmostEqual(result["rows"][0]["confidenceScaled"], 0.75)
        rows[0]["label"] = 2
        report, raw = fixture(rows)
        with self.assertRaisesRegex(ValueError, "zero-based integer"):
            HELPER.apply_temperature(encoded(report), raw, "test")

    def test_saved_real_model_matches_exported_predictions(self):
        report_path = ROOT / "review" / "digits-experiment.json"
        raw_path = ROOT / "public" / "examples" / "optdigits.json"
        predictions_path = ROOT / "review" / "digits-predictions.csv"
        result = HELPER.apply_temperature(report_path.read_bytes(), raw_path.read_bytes(), "test")
        with predictions_path.open(encoding="utf-8", newline="") as source:
            expected = list(csv.DictReader(source))
        self.assertEqual(result["rowCount"], 1797)
        self.assertEqual(len(expected), len(result["rows"]))
        for actual, reference in zip(result["rows"], expected):
            self.assertEqual(actual["id"], reference["id"])
            self.assertEqual(actual["correct"], reference["correct"] == "true")
            self.assertAlmostEqual(actual["confidenceOriginal"], float(reference["confidence_original"]), places=14)
            self.assertAlmostEqual(actual["confidenceScaled"], float(reference["confidence_scaled"]), places=14)

    def test_cli_writes_valid_json_and_refuses_to_overwrite(self):
        report, raw = fixture()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            assessment = path / "assessment.json"
            logits = path / "input.json"
            output = path / "scaled.json"
            assessment.write_bytes(encoded(report))
            logits.write_bytes(raw)
            command = [sys.executable, str(SCRIPT), str(assessment), str(logits), "--output", str(output)]
            first = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertEqual(json.loads(output.read_text(encoding="utf-8"))["rowCount"], 1)
            second = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(second.returncode, 0)
            self.assertEqual(logits.read_bytes(), raw)


if __name__ == "__main__":
    unittest.main()
