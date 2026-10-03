# Agent audit and optional usability round

This folder records **five agent-led scenario audits using generated fixtures**, not five people or independent-user validation. See [actual audit results](agent-audit.md). Run `node docs/usability/run-agent-audit.ts` from the repository root; generated exports go to ignored `.cache/agent-audit/`.

| Audit | Scenario |
| --- | --- |
| A1 | Confidence CSV import, measurement and exports |
| A2 | Multiclass logits, calibration-only fit and separate evaluation |
| A3 | Malformed inputs and useful rejection errors |
| A4 | Policy lock, test inspection and later changes |
| A5 | Export escaping, default privacy and explicit raw inclusion |

These local module/CLI checks cannot establish whether people understand the interface or whether browser downloads work. No real user data, invitations or analytics are involved. Human sessions, genuine own-data imports and outsider reproduction are unattempted.

## Optional future human protocol

**Not scheduled.** No invitations have been sent and no outsiders have tested this protocol. The following plan is retained for when participants become available. Maintainer checks and automated tests do not count as participant sessions.

Run five 35–45 minute sessions with people who did not build the app. This is a small qualitative round to find specific difficulties, not statistical evidence of usability, demand or model quality. Report observations and counts with their denominator, not population success rates.

## Recruit and schedule

| Slot | Intended experience | Data requirement | Status |
| --- | --- | --- | --- |
| P1 | Uses saved classifier outputs | Their own authorised confidence/correctness CSV | Pending recruitment |
| P2 | Works with class logits and labelled evaluation data | Their own authorised logits JSON | Pending recruitment |
| P3 | Evaluates models and can run Node/Python commands | Public reference; independent reproduction follow-up | Pending recruitment |
| P4 | Uses prediction reports, less calibration experience | Public reference | Pending recruitment |
| P5 | Uses prediction reports or model evaluation | Public reference | Pending recruitment |

Aim for different levels of calibration familiarity. Do not count a maintainer, agent, or the facilitator as an outsider. The round requires **at least two eligible own-data imports**. The CSV/logits mix is a recruitment target; record a deviation if both bring the same format. If someone cannot use their data with permission, use the public reference and recruit another eligible participant for the unmet own-data slot. Do not invent split labels, outcomes or logits to make a file fit.

Ask before scheduling: Have you used saved classifier predictions? Which format can you bring? Are you authorised to use those observations in this browser tool and, separately, show any part of them during the session? Can you run Git, Node and Python for a follow-up? Collect contact details privately, outside this repository. Do not ask for a file to be emailed or attached.

## Run the round

1. The owner sends the [invitation draft](invitation.md) after choosing participants; this repository does not send it.
2. Use the [facilitator guide](facilitator-guide.md) and one private copy of the [recording sheet](recording-sheet.md) per person.
3. Ask at least one eligible outsider to complete [independent reproduction](reproduction.md) on their own machine without live maintainer help. Record assistance if requested; a command-line check by the author does not meet this requirement.
4. After each session, record observed problems, their consequences and any assistance. After all sessions, group repeated problems, prioritise mistaken conclusions or blocked tasks, and retest fixes with affected participants where possible.

The first round is complete only after five genuine sessions, at least two eligible own-data imports, and an independently attempted reproduction have records. A failed or blocked reproduction remains a result, not a completed success. Recruitment, sessions, follow-up and synthesis are all **pending**.

## Data handling

Use participant codes, not names, in notes. Default to handwritten or typed notes; no audio/video recording. Ask permission for the session and notes, allow skipping and stopping, and agree a deletion date. Keep private notes outside Git. Own-data screen sharing is optional and requires separate permission; the participant can describe the UI without showing rows. Redact filenames, IDs, classes, provenance, labels, scores and small-group information from shared notes or screenshots. Do not commit real participant files, exports or contact details. No analytics or tracking changes are part of this study.

Publish only a redacted issue description after review. The [feedback form](../../.github/ISSUE_TEMPLATE/usability-feedback.yml) is public and must never contain real prediction rows. A public issue is not required to participate.

The neutral task and observation approach follows [GOV.UK's moderated usability guidance](https://www.gov.uk/service-manual/user-research/using-moderated-usability-testing). The five-person scope is a practical first round, not a claim that five people discover every problem.
