import csv
import math
from pathlib import Path


def export_confidence(path, ids, confidence, predicted, observed, splits):
    columns = [ids, confidence, predicted, observed, splits]
    if not ids or any(len(column) != len(ids) for column in columns):
        raise ValueError("All arrays must have the same nonzero length")
    if len(set(ids)) != len(ids) or any(not isinstance(value, str) or not value.strip() for value in ids):
        raise ValueError("Use unique, nonempty string IDs")
    allowed = {"calibration", "policy_validation", "test", "exploration"}
    rows = []
    for row_id, score, prediction, outcome, split in zip(*columns):
        if isinstance(score, bool) or not isinstance(score, (int, float)) or not math.isfinite(score) or not 0 <= score <= 1:
            raise ValueError("Confidence must be a finite probability")
        if split not in allowed:
            raise ValueError("Assign each split explicitly")
        if prediction is None or outcome is None:
            raise ValueError("Every prediction needs a known outcome")
        rows.append([row_id, score, prediction == outcome, split])
    with Path(path).open("x", encoding="utf-8", newline="") as output:
        writer = csv.writer(output)
        writer.writerow(["id", "confidence", "correct", "split"])
        writer.writerows(rows)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Write a synthetic format example, not an evaluation dataset")
    parser.add_argument("output")
    args = parser.parse_args()
    export_confidence(args.output, ["example-1", "example-2", "example-3"],
                      [.9, .7, .6], ["cat", "dog", "cat"], ["cat", "cat", "cat"],
                      ["exploration"] * 3)
