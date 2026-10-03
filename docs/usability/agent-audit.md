# Agent-led scenario audit

**Run completed on 3 October 2026; human participants: zero.** These are five local module/CLI scenario audits, not five users or external usability validation. Only generated fixtures and the public digits reference were used. No real own-data import was tested and no recruitment messages were sent.

The [machine-readable result](agent-audit-results.json) records Node 24.9.0, app 0.1.0, numerical 2.0.1 at `6e74b92dfc5c545a1cd926f96bd5bc44ae6c887b`, app Git HEAD and the tested source digest. The script imports the actual parser, analysis, fitting, policy and export modules. It writes HTML/JSON/CSV to disk and reads their contents back. This does not exercise the browser download mechanism.

| Audit | Actual result |
| --- | --- |
| A1: confidence CSV | Passed. Ten generated rows became exploration data; accuracy 0.6, ECE 0.3, NLL unavailable. Fitting and applying non-unit temperature were rejected. HTML/JSON/CSV were written and read back. |
| A2: multiclass logits | Passed. Calibration 300, policy validation 150, test 150. Fit converged at T=2.2022061673554587. Changing only held-out labels left the fit identical. Test accuracy stayed 0.7; confidence changed. At 80%, no scaled rows were accepted, so accepted error rate was null rather than zero. Three exports were written and read back. |
| A3: malformed inputs | Passed. All seven cases were rejected: duplicate IDs, out-of-range confidence, invalid correctness token, malformed JSON, out-of-range label, absent logit split and mismatched class dimensions. Errors identify the offending row where available. |
| A4: policy sequence | Passed. Lock-before-test, early test inspection and changing then relocking remained distinguishable. Relocking did not erase the exploratory status. Group assessment remained exploratory. Empty acceptance returned no risk estimate. |
| A5: export content | Passed. Generated script-like names were escaped in HTML; default JSON omitted raw IDs and arbitrary provenance. Explicit inclusion retained the two generated rows. A formula-like CSV ID received a leading apostrophe. |

No functional bug was observed in these cases. An empty accepted set after fitting is an expected result in A2, not evidence of a safe zero-error policy. These assertions do not establish that a person would interpret it correctly.

## Independent calculation check

The separate Python standard-library checker recomputed the public reference's NLL, equal-width ECE, accuracy and threshold counts from original logits at the saved T. It matched all 1,797 test rows in the generated prediction CSV and Python replay output. Expected counts were 1,635 accepted, 162 abstained and 31 accepted errors. A deliberately altered NLL was rejected. This is an independent implementation run by the agent, **not an independent external reviewer** and not a new optimisation of T.

The runner passed a standalone TypeScript check; the feedback form parsed as YAML with unique field IDs. This audit added no application runtime code or analytics.

## Repeat and inspect

```sh
node docs/usability/run-agent-audit.ts
python docs/usability/verify_reference.py review/digits-experiment.json public/examples/optdigits.json --csv review/digits-predictions.csv
```

Generated fixtures are `.cache/agent-audit/input-confidence.csv`, `input-logits.json` and `input-invalid.csv`. Generated exports are `a1-confidence.*`, `a2-logits.*` and `a5-escaping.*` in the same directory. Repeated audit runs replace only these generated audit outputs; the committed result remains the recorded snapshot. The [reproduction checklist](reproduction.md) explains the saved-temperature replay and how to test actual browser-downloaded exports separately.

Browser rendering, keyboard use, worker messaging, session storage, hosted networking and browser downloads were not observed in this module audit. A separate [browser workflow check](browser-audit.md) records interface observations and actual downloaded files. Human understanding, genuine own-data use, independently attempted reproduction by an outsider and accessibility with assistive technology remain untested. The [human protocol](facilitator-guide.md) is optional future work, with all recruitment and sessions pending.
