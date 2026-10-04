import json
import math
from pathlib import Path


def export_logits(path, ids, logits, label_indices, splits, classes):
    columns = [ids, logits, label_indices, splits]
    if not ids or any(len(column) != len(ids) for column in columns):
        raise ValueError("All arrays must have the same nonzero length")
    if len(set(ids)) != len(ids) or any(not isinstance(value, str) or not value.strip() for value in ids):
        raise ValueError("Use unique, nonempty string IDs")
    if not 2 <= len(classes) <= 100 or len(set(classes)) != len(classes):
        raise ValueError("Supply 2 to 100 unique classes in the model's exact output order")
    allowed = {"calibration", "policy_validation", "test", "exploration"}
    rows = []
    for row_id, scores, label, split in zip(*columns):
        if len(scores) != len(classes) or any(isinstance(score, bool) or not isinstance(score, (int, float)) or not math.isfinite(score) for score in scores):
            raise ValueError("Each row needs one finite raw logit per class")
        if isinstance(label, bool) or not isinstance(label, int) or not 0 <= label < len(classes):
            raise ValueError("Labels must be explicit zero-based indices into classes")
        if split not in allowed:
            raise ValueError("Assign each split explicitly")
        rows.append({"id": row_id, "logits": list(scores), "label": label, "split": split})
    with Path(path).open("x", encoding="utf-8") as output:
        json.dump({"schemaVersion": 1, "name": "Saved classifier predictions", "kind": "logits", "classes": list(classes), "rows": rows}, output, allow_nan=False, indent=2)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Write a synthetic format example, not an evaluation dataset")
    parser.add_argument("output")
    args = parser.parse_args()
    export_logits(args.output, ["example-1", "example-2", "example-3", "example-4", "example-5", "example-6"],
                  [[0, 2], [2, 0], [1, 2], [2, 1], [0, 3], [3, 0]], [1, 0, 1, 1, 1, 0],
                  ["calibration"] * 2 + ["policy_validation"] * 2 + ["test"] * 2, ["cat", "dog"])
