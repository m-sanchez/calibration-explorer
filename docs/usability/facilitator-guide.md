# Optional human facilitator guide

**No participants available; all human sessions pending.** This future protocol is separate from the current agent scenario audits. Use one [recording sheet](recording-sheet.md) per participant. Allow 35–45 minutes; the reproduction follow-up is separate. Read only the participant prompts, not the expected outcomes.

## Before the session

Confirm voluntary participation, note-taking permission and an agreed deletion date. Record participant code, evaluation experience, browser/OS, actual app version and Space/source revision. Use the same frozen build within a round; if it changes, record which people saw which version. Start in a fresh browser session, but never describe data already inspected elsewhere as unseen. Do not erase a test-inspection warning to make a task look successful.

P1 and P2 keep authorised data on their own machines. Preparation can use the documented templates, but record preparation time and help separately. Confirm unique IDs, genuine known outcomes and honest split provenance; do not request raw values for the notes. If permission or format eligibility is missing, record the reason and use the public reference without counting an own-data success.

Read: “We are checking the tool, not you. Please say what you are trying and what you expect. Use any help you find in the app. You may skip or stop. I will mostly observe and will ask before helping.” Do not demonstrate the interface first.

## Tasks

| Task and timebox | Read to the participant | Observe privately |
| --- | --- | --- |
| 1. Choose an input, 4 min | “One file has top-confidence scores and whether each prediction was correct. Another has every class logit and the true class. What could you do with each here?” | Distinguishes measuring CSV from fitting logits; knows neither runs a classifier. Record misconceptions before explaining. |
| 2. Import, 7 min | Own-data slots: “Use the saved predictions you brought to start an assessment. Tell me whether the app has interpreted your file as you expected.” Other slots: “Use the public digits example to start an assessment.” | Import confirmed, format/count/split meaning checked. Record CSV versus logits, preparation, parser failures and fixes. Empty or fabricated partitions do not pass. Do not record actual rows. |
| 3. Inspect, 5 min | “Using the public digits example, look at policy-validation observations and keep test results unopened for the next task. What does confidence appear to tell you about correctness? Show something that supports your answer.” | Chooses intended split; reads a nonempty bin, count and gap; does not claim low ECE proves calibration. Own-data slots now switch to the public reference so later tasks are comparable. |
| 4. Fit and choose a policy, 8 min | “A colleague wants to adjust confidence using calibration observations, then assess an acceptance rule on other data. Use an 80% confidence cutoff for this exercise, record the rule before opening test results, and then evaluate it. Explain your choices.” | Temperature fitted using calibration only; threshold assessed on policy validation; full partition selected; policy locked before test inspection. If test is opened early, record the order and exploratory status. 80% is fixed for comparison, not a recommendation. |
| 5. Interpret, 4 min | “What changed, what stayed the same, and what would this result let you claim about a new deployment?” | Distinguishes confidence/NLL/ECE from unchanged predicted classes/accuracy; understands acceptance can change and generalisation is unproven. For this digits fit, T<1 sharpens confidence. A lower score is not a safety certificate. |
| 6. Save evidence, 6 min | “Save something a colleague could read, something they could reproduce, and the selected prediction rows. Show how you would find the saved files and decide what is safe to share.” | Actual HTML, JSON and CSV files appear and open. HTML/JSON settings and metrics agree; CSV has selected rows. Default raw inclusion remains off; identifies CSV row IDs and optional all-split JSON as sensitive. A toast or clicked link alone is not a verified download. |

Ask at the end: “Which part required the most guesswork?”, “What would you do next with your own predictions?”, and “What would stop you using it?” Do not ask whether the tool is professional, impressive or easy. Ask P3 (or another eligible volunteer) to attempt [reproduction](reproduction.md) independently within 48 hours; do not walk through the commands during the session.

## Scoring and assistance

Start timing after reading the prompt; stop when the participant declares completion, abandons, or reaches the timebox. Record elapsed time and pauses separately. Timeboxes keep the session manageable; they are not speed targets or performance benchmarks.

- **Unassisted:** reaches the observed outcome without facilitator hints. Reading the app's help counts as unassisted.
- **Assisted:** reaches the outcome after a navigational or conceptual hint. Record the exact hint and when it was given.
- **Failed:** declares completion with the wrong result, cannot complete after offered assistance, or stops at the timebox without completing. Record the cause; do not silently complete it for them.
- **Abandoned:** chooses to stop this task. Record their reason if offered.
- **Not attempted:** skipped for time, consent, missing data or environment constraints. This is neither success nor failure; report it separately.

After about 60 seconds without progress, ask “What are you trying to find?” This neutral probe is not a hint. If still blocked, ask permission to give one small hint, record it, and continue as assisted. Technical outages are recorded separately from usability failures. Incorrect conclusions about test independence, changed predictions or deployment safety are substantive findings even if every button task succeeds.

## Afterward

Verify the notes contain no participant predictions or identifying details. Capture one concrete sequence per problem: intention, observed action, consequence and assistance. Prioritise blocked imports/exports or misleading evaluation conclusions, then repeat friction. Keep single observations distinguishable from repeated ones. Report the five individual outcomes and limitations; do not infer population rates. Share proposed fixes with participants only through the owner's agreed route and ask permission before a retest.
