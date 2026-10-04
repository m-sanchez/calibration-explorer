# Prepare predictions locally

These two Python 3 standard-library recipes write the existing canonical formats. Use files directly through the local MCP, or import them into the browser. Neither recipe trains a classifier, runs inference or creates evaluation partitions.

## Confidence CSV

Copy [export_confidence.py](../public/recipes/export_confidence.py) beside your experiment and call:

```python
from export_confidence import export_confidence

export_confidence("predictions.csv", ids, confidence, predicted, observed, splits)
```

All arrays have the same length. `ids` contains unique stable strings. `confidence` is the probability assigned to the predicted class; `predicted` and `observed` use the same explicit label representation. Their equality determines `correct`. Confidence-only files support measurements and thresholds, not temperature fitting or NLL.

## Logit JSON

Copy [export_logits.py](../public/recipes/export_logits.py) beside your experiment and call:

```python
from export_logits import export_logits

export_logits("predictions.json", ids, logits, label_indices, splits, classes)
```

`classes` must match the model's exact output-column order. Each `label_indices` value is the zero-based index of the observed class in that order. Each `logits` row contains one finite raw score per class. Do not substitute probabilities for raw logits or silently reinterpret a class label as an index.

## Explicit partitions and examples

Supply `calibration`, `policy_validation`, `test` or `exploration` for every row. Keep related observations together according to the experiment design. The recipes do not infer train/test meaning or claim that random row splitting establishes independent observations.

To create the small synthetic format examples:

```text
python public/recipes/export_confidence.py confidence-example.csv
python public/recipes/export_logits.py logits-example.json
```

The CSV has 3 exploration rows. The JSON has 2 calibration, 2 policy-validation and 2 test rows. These are format examples, not sufficient evaluation samples. Both refuse to overwrite an existing file. The browser's “Prepare predictions with Python” disclosure also has copy buttons for the complete recipes.

`tests/recipes.test.ts` executes both scripts and validates their outputs through the application importer. Existing strict validation, class/row limits and duplicate-ID checks still apply when loading your output.
