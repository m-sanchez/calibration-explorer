import argparse
import csv
import hashlib
import json
import math
from pathlib import Path


EXPECTED_HASH = "18f281567b4a749dabe3819a427d32d228b85a7226c7785c10a99d88cf0d46d7"
EXPECTED_TEMPERATURE = 0.7259783904070843
EXPECTED_BEFORE = {"accuracy": 0.9488035614913745, "ece": 0.03654894805641917, "nll": 0.17595188348336863}
EXPECTED_AFTER = {"accuracy": 0.9488035614913745, "ece": 0.01007905702195184, "nll": 0.15752642621016594}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def close(actual, expected, label, tolerance=1e-10):
    require(isinstance(actual, (float, int)) and math.isfinite(actual), f"{label}: missing or nonfinite number")
    require(abs(actual - expected) <= tolerance, f"{label}: {actual} differs from {expected}")


def measure(rows, temperature):
    predictions = []
    losses = []
    for row in rows:
        logits = row["logits"]
        predicted = max(range(len(logits)), key=logits.__getitem__)
        maximum = logits[predicted]
        scaled = [(value - maximum) / temperature for value in logits]
        normalizer = math.fsum(math.exp(value) for value in scaled)
        confidence = 1 / normalizer
        correct = predicted == row["label"]
        predictions.append((row["id"], confidence, correct))
        losses.append(math.log(normalizer) - scaled[row["label"]])
    buckets = [[] for _ in range(15)]
    for _, confidence, correct in predictions:
        buckets[min(14, math.floor(confidence * 15))].append((confidence, correct))
    metrics = {
        "accuracy": math.fsum(correct for _, _, correct in predictions) / len(rows),
        "ece": math.fsum(abs(math.fsum(confidence - correct for confidence, correct in bucket)) for bucket in buckets) / len(rows),
        "nll": math.fsum(losses) / len(rows),
    }
    return metrics, predictions


def verify(assessment_path, input_path, csv_path=None, replay_path=None):
    raw = input_path.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == EXPECTED_HASH, "Use the unchanged bundled digits JSON; input hash differs")
    data = json.loads(raw)
    record = json.loads(assessment_path.read_bytes())
    require(record["data"]["sha256"] == EXPECTED_HASH, "Assessment identifies a different input")
    require(data["classes"] == [str(i) for i in range(10)], "Class order differs")
    require(record["configuration"] == {"split": "test", "bins": 15, "strategy": "equal-width", "temperature": record["fit"]["temperature"], "threshold": 0.8, "group": None}, "Use test, 15 equal-width bins, 80% threshold and no slice")
    require(record["fit"]["status"] == "converged", "Reference fit did not converge")
    temperature = record["fit"]["temperature"]
    close(temperature, EXPECTED_TEMPERATURE, "temperature", 1e-6)
    rows = [row for row in data["rows"] if row["split"] == "test"]
    require(len(rows) == 1797, "Reference test row count differs")
    before, original = measure(rows, 1)
    after, scaled = measure(rows, temperature)
    for label, metrics, expected in [("before", before, EXPECTED_BEFORE), ("after", after, EXPECTED_AFTER)]:
        require(record[label]["n"] == 1797, f"{label}: assessment row count differs")
        for key, value in metrics.items():
            close(record[label][key], value, f"{label}.{key} against Python")
            close(value, expected[key], f"{label}.{key} against baseline", 1e-7)
    accepted = [row for row in scaled if row[1] >= 0.8]
    counts = {"accepted": len(accepted), "abstained": len(rows) - len(accepted), "errors": sum(not row[2] for row in accepted)}
    require(counts == {"accepted": 1635, "abstained": 162, "errors": 31}, "Threshold counts differ")
    for key, value in counts.items():
        require(record["decision"][key] == value, f"decision.{key} differs")
    close(record["decision"]["coverage"], counts["accepted"] / len(rows), "coverage")
    close(record["decision"]["risk"], counts["errors"] / counts["accepted"], "accepted error rate")
    if csv_path:
        with csv_path.open(encoding="utf-8-sig", newline="") as stream:
            exported = list(csv.DictReader(stream))
        require(len(exported) == len(rows), "CSV row count differs")
        for entry, source, unscaled, adjusted in zip(exported, rows, original, scaled):
            require(entry["id"] == source["id"] and entry["split"] == "test", "CSV row identity or order differs")
            require(entry["correct"].lower() == str(adjusted[2]).lower(), "CSV correctness differs")
            close(float(entry["confidence_original"]), unscaled[1], "CSV original confidence")
            close(float(entry["confidence_scaled"]), adjusted[1], "CSV scaled confidence")
    if replay_path:
        replay = json.loads(replay_path.read_bytes())
        require(replay["rowCount"] == len(rows) and len(replay["rows"]) == len(rows), "Replay row count differs")
        require(replay["inputSha256"] == EXPECTED_HASH, "Replay input hash differs")
        for entry, source, unscaled, adjusted in zip(replay["rows"], rows, original, scaled):
            require(entry["id"] == source["id"] and entry["correct"] == adjusted[2], "Replay identity or correctness differs")
            close(entry["confidenceOriginal"], unscaled[1], "Replay original confidence")
            close(entry["confidenceScaled"], adjusted[1], "Replay scaled confidence")
    return {"status": "passed", "rows": len(rows), "temperature": temperature, "before": before, "after": after, "decision": counts, "csvChecked": csv_path is not None, "replayChecked": replay_path is not None}


def main():
    parser = argparse.ArgumentParser(description="Independently recompute the fixed public digits assessment using Python's standard library. Does not refit temperature or evaluate private data.")
    parser.add_argument("assessment", type=Path)
    parser.add_argument("input", type=Path)
    parser.add_argument("--csv", type=Path)
    parser.add_argument("--replay", type=Path)
    args = parser.parse_args()
    try:
        result = verify(args.assessment, args.input, args.csv, args.replay)
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(1, f"FAIL: {error}\n")
    print(json.dumps(result, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
