import argparse
import hashlib
import json
import math
import re
from pathlib import Path


SPLITS = ("calibration", "policy_validation", "test", "exploration")


def reject_constant(value):
    raise ValueError(f"Nonfinite JSON value {value} is not supported.")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON field {key!r} is ambiguous.")
        result[key] = value
    return result


def read_json(raw, label):
    try:
        return json.loads(raw.decode("utf-8-sig"), parse_constant=reject_constant, object_pairs_hook=unique_object)
    except (ValueError, UnicodeError) as error:
        raise ValueError(f"{label}: {error}") from error


def finite_number(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be a finite number.")
    try:
        number = float(value)
    except OverflowError as error:
        raise ValueError(f"{label} must be a finite number.") from error
    if not math.isfinite(number):
        raise ValueError(f"{label} must be a finite number.")
    return number


def class_names(value, label):
    if value is None:
        return None
    if not isinstance(value, list) or len(value) < 2:
        raise ValueError(f"{label} must be an ordered list of at least two class names.")
    if any(not isinstance(name, str) or not name.strip() for name in value):
        raise ValueError(f"{label} must contain nonempty string names.")
    names = [name.strip() for name in value]
    if len(set(names)) != len(names):
        raise ValueError(f"{label} contains duplicate class names.")
    return names


def top_confidence(logits, temperature):
    maximum = max(logits)
    weights = []
    for value in logits:
        difference = value - maximum
        centered = difference / temperature if math.isfinite(difference) else value / temperature - maximum / temperature
        weights.append(math.exp(centered))
    return 1.0 / math.fsum(weights)


def apply_temperature(assessment_bytes, input_bytes, split=None):
    if split is not None and split not in SPLITS:
        raise ValueError(f"split must be one of {', '.join(SPLITS)}.")
    assessment = read_json(assessment_bytes, "Assessment")
    if not isinstance(assessment, dict) or type(assessment.get("schemaVersion")) is not int or assessment["schemaVersion"] != 1:
        raise ValueError("Assessment must be a schemaVersion 1 exported assessment object.")
    data = assessment.get("data")
    configuration = assessment.get("configuration")
    fit = assessment.get("fit")
    if not isinstance(data, dict) or data.get("kind") != "logits":
        raise ValueError("Assessment must describe a logits dataset.")
    if not isinstance(configuration, dict) or not isinstance(fit, dict):
        raise ValueError("Assessment must contain a saved fitted temperature and its configuration.")
    expected_hash = data.get("sha256")
    if not isinstance(expected_hash, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", expected_hash):
        raise ValueError("Assessment data.sha256 must be a 64-character SHA-256 digest.")
    input_hash = hashlib.sha256(input_bytes).hexdigest()
    if input_hash != expected_hash.lower():
        raise ValueError("Input SHA-256 does not match the assessment; use the unchanged original logits JSON file.")
    temperature = finite_number(fit.get("temperature"), "fit.temperature")
    if temperature <= 0:
        raise ValueError("fit.temperature must be positive.")
    configured_temperature = finite_number(configuration.get("temperature"), "configuration.temperature")
    if configured_temperature != temperature:
        raise ValueError("The configured temperature does not match the saved fitted temperature.")
    source = read_json(input_bytes, "Input")
    if isinstance(source, list):
        rows = source
        classes = None
    elif isinstance(source, dict) and type(source.get("schemaVersion")) is int and source["schemaVersion"] == 1:
        if source.get("kind", "logits") != "logits":
            raise ValueError("Input kind must be logits.")
        rows = source.get("rows")
        classes = class_names(source.get("classes"), "Input classes")
    else:
        raise ValueError("Input must be a schemaVersion 1 logits dataset or an array of logit rows.")
    if not isinstance(rows, list) or not rows:
        raise ValueError("Input must contain a nonempty rows array.")
    if type(data.get("rowCount")) is not int or data["rowCount"] != len(rows):
        raise ValueError("Input row count does not match the assessment.")
    report_classes = class_names(data.get("classes"), "Assessment classes")
    if classes != report_classes:
        raise ValueError("Input class ordering does not match the assessment.")
    dimension = len(classes) if classes is not None else None
    predictions = []
    seen = set()
    for index, row in enumerate(rows):
        location = f"Input row {index + 1}"
        if not isinstance(row, dict):
            raise ValueError(f"{location} must be an object.")
        row_id = row.get("id")
        if not isinstance(row_id, str) or not row_id.strip():
            raise ValueError(f"{location} needs a nonempty string id.")
        row_id = row_id.strip()
        if row_id in seen:
            raise ValueError(f"{location} has duplicate id {row_id!r}.")
        seen.add(row_id)
        row_split = row.get("split")
        if not isinstance(row_split, str) or row_split.strip() not in SPLITS:
            raise ValueError(f"{location} needs an explicit supported split.")
        row_split = row_split.strip()
        logits = row.get("logits")
        if not isinstance(logits, list) or len(logits) < 2:
            raise ValueError(f"{location} needs at least two logits.")
        if dimension is None:
            dimension = len(logits)
        if len(logits) != dimension:
            raise ValueError(f"{location} has {len(logits)} logits; expected {dimension} in the original class order.")
        logits = [finite_number(value, f"{location} logits[{column}]") for column, value in enumerate(logits)]
        label = row.get("label")
        if type(label) is not int or not 0 <= label < dimension:
            raise ValueError(f"{location} label must be a zero-based integer from 0 to {dimension - 1}.")
        group = row.get("group")
        if group is not None and not isinstance(group, str):
            raise ValueError(f"{location} group must be a string when present.")
        if split is not None and row_split != split:
            continue
        predicted_class = max(range(dimension), key=logits.__getitem__)
        prediction = {
            "id": row_id,
            "split": row_split,
            "label": label,
            "predictedClass": predicted_class,
            "correct": predicted_class == label,
            "confidenceOriginal": top_confidence(logits, 1.0),
            "confidenceScaled": top_confidence(logits, temperature),
        }
        if classes is not None:
            prediction["predictedLabel"] = classes[predicted_class]
        if group is not None and group.strip():
            prediction["group"] = group.strip()
        predictions.append(prediction)
    return {
        "schemaVersion": 1,
        "operation": "apply_temperature",
        "inputSha256": input_hash,
        "assessmentSha256": hashlib.sha256(assessment_bytes).hexdigest(),
        "temperature": temperature,
        "fitStatus": fit.get("status"),
        "classes": classes,
        "classCount": dimension,
        "classOrder": "Declared class names" if classes is not None else "Original zero-based logit column indices",
        "selection": {"split": split},
        "rowCount": len(predictions),
        "rows": predictions,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Apply the fitted temperature in a Calibration Explorer assessment to its unchanged original logits JSON. Uses only the Python standard library; never fits or tunes a temperature.",
        epilog="Example: python scripts/apply_temperature.py review/digits-experiment.json public/examples/optdigits.json --split test --output scaled-predictions.json. The input SHA-256 must match the assessment exactly. Without --split, all original rows are processed. Class choices use the raw logits, with the first column winning exact ties. Existing output files are refused.",
    )
    parser.add_argument("assessment", type=Path, help="Exported assessment JSON containing data.sha256, configuration.temperature, and fit.temperature.")
    parser.add_argument("logits", type=Path, help="Unchanged original logits JSON file used for the assessment.")
    parser.add_argument("--output", required=True, type=Path, help="New JSON file for predicted classes and original/scaled top confidence.")
    parser.add_argument("--split", choices=SPLITS, help="Optionally emit only this split; all input rows are validated.")
    args = parser.parse_args(argv)
    try:
        if args.output.resolve() in (args.assessment.resolve(), args.logits.resolve()):
            raise ValueError("Output must differ from both input paths.")
        result = apply_temperature(args.assessment.read_bytes(), args.logits.read_bytes(), args.split)
        serialized = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        with args.output.open("x", encoding="utf-8", newline="\n") as output:
            output.write(serialized)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    print(json.dumps({"output": str(args.output), "rows": result["rowCount"], "temperature": result["temperature"], "inputSha256": result["inputSha256"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
