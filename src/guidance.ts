import type { Dataset, Split } from "./domain.ts";
import type { PolicyState } from "./policy.ts";
import type { FitAttempt } from "./fit.ts";

export function nextAction(input: { kind: Dataset["kind"]; counts: Record<Split, number>; split: Split; policy: PolicyState; fit: FitAttempt | null; group: string; view: string; evaluationFailure: string | null }): { text: string; label: string; action: string } {
  if (input.evaluationFailure) return { text: "Scaled evaluation is unavailable. Review the fit result before continuing.", label: "Review fit", action: "calibrate" };
  if (input.view === "export") return { text: "Review the selected split and disclosure settings before sharing.", label: "Preview report", action: "preview-report" };
  if (input.group) return { text: "This slice is exploratory. Return to all observations before locking a policy.", label: "Show all observations", action: "clear-group" };
  if (input.kind === "logits" && input.counts.calibration && !input.fit && !input.policy.testViewed) return input.view === "calibrate"
    ? { text: "Fit temperature using calibration rows only. Other splits are not used by the fitter.", label: "Fit on calibration data", action: "fit" }
    : { text: "Next: fit temperature using calibration rows only.", label: "Open calibration", action: "calibrate" };
  if (input.fit && input.fit.status !== "applied") return { text: "No temperature was applied. You can inspect original predictions or export this result.", label: "Open export", action: "export" };
  if (input.policy.changedAfterTest) return { text: "Test outcomes have already informed this session. Further changes remain exploratory.", label: "Open export", action: "export" };
  if (input.policy.locked && !input.policy.testViewed && input.counts.test) return { text: "Policy locked. Review test outcomes when you are ready.", label: "Review test results", action: "next-test" };
  if (input.counts.policy_validation && !input.policy.locked && input.counts.test) return input.view === "decide" && input.split === "policy_validation"
    ? { text: "Choose the threshold below. Lock it when you are ready to review test outcomes.", label: "Lock selected threshold", action: "lock" }
    : { text: "Next: choose an acceptance threshold on policy validation, then lock it.", label: "Open policy validation", action: "next-policy" };
  return { text: input.policy.testViewed ? "The selected results are ready to inspect and export." : "Inspect or export these observations. A separate policy-validation split is required to lock a policy.", label: "Open export", action: "export" };
}
