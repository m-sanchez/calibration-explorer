# Browser workflow check

Checked on 3 October 2026 using the in-app Chromium browser on Windows. Human participants: zero. The inputs were the generated fixtures from `run-agent-audit.ts`, not someone else's real predictions.

The local website mirror served the pinned release source `164eece9b2ed3a038d8ae645088b0ab70e1c33db` at `/calibration-explorer/`. Its source and file hashes are recorded in the website's public mirror manifest. The following actions used the rendered interface and native file chooser.

| Check | Observed result |
| --- | --- |
| Confidence CSV | Imported 10 exploration rows. Accuracy 60%, mean confidence 90%, ECE 0.3000. Temperature fitting was disabled with an explanation that logits and labels are required. |
| Invalid CSV | Duplicate ID was rejected; the error identified CSV rows 3 and 2. |
| Logit JSON | Preview showed 300 calibration, 150 policy-validation and 150 test rows. Fitting converged at T = 2.2022061673554587. |
| Policy sequence | Locked the 80% threshold on policy-validation data before opening test. The interface and exported record retained that sequence. Zero accepted rows displayed an unavailable error rate. |
| Held-out comparison | Test accuracy remained 70%; NLL changed from 1.0658839038 to 0.8038277290 and ECE from 0.2362395519 to 0.0048729977. |
| Linked chart | Selecting the original chart point changed the detail panel to bin 15, 150 rows, 93.6% confidence, 70% accuracy and 0.2362 ECE contribution. |
| Browser exports | HTML, JSON and CSV files appeared in Downloads. Their saved contents were read back and checked, including the locked policy, expected numerical results, and all 150 test rows. |

The automation's download-event observer timed out for HTML, but the file was present on disk. Completion is based on the saved file and its contents, not the click or observer status. Copies of the actual generated-data downloads are retained here: [HTML](browser-evidence/generated-logits.html), [JSON](browser-evidence/generated-logits.json), [CSV](browser-evidence/generated-logits.csv).

After deployment, `https://miguelsanchez.co.uk/calibration-explorer/` loaded its reference data and ran temperature fitting in the worker. The displayed digits temperature was 0.72598, using 574 calibration rows. The browser reported no console errors during that check. This live check was narrower than the complete local import-to-export workflow.

The earlier Hugging Face hostname failure was reported in an external browser and subsequently reported working again. Its cause was not established. The website copy provides another host; it does not prove that every browser or network can reach either host.

This establishes observed software behaviour for these cases. It does not measure human understanding, actual own-data adoption, external reproduction, or accessibility with assistive technology.
