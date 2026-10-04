import type { Dataset, Split } from "./domain.ts";
import { assessmentStatus, changePolicy, inspectTest, lockPolicy, newPolicy, type PolicyState } from "./policy.ts";

export interface InspectionHistory {
  has(key: string): boolean;
  mark(key: string): void;
}

export class AssessmentWorkflow {
  readonly counts: Record<Split, number>;
  private policy: PolicyState;
  private keys: string[];
  private history: InspectionHistory;

  constructor(dataset: Dataset, keys: string[], history: InspectionHistory) {
    this.keys = [...keys];
    this.history = history;
    this.counts = { calibration: 0, policy_validation: 0, test: 0, exploration: 0 };
    dataset.rows.forEach(row => this.counts[row.split]++);
    this.policy = newPolicy(keys.some(key => history.has(key)));
  }

  get state(): PolicyState {
    if (!this.policy.testViewed && this.keys.some(key => this.history.has(key))) {
      this.policy = newPolicy(true);
    }
    return structuredClone(this.policy);
  }

  initialSplit(): Split | null {
    return (["policy_validation", "calibration", "exploration"] as const)
      .find(split => this.counts[split] > 0) ?? null;
  }

  requireInspection(split: Split): void {
    if (!this.counts[split]) throw new Error(`No ${split} observations are available.`);
    if (split === "test" && !this.state.testViewed) {
      throw new Error("Test results are unopened. Explicit test review is required.");
    }
  }

  reviewTest(): void {
    if (!this.counts.test) throw new Error("No test observations are available.");
    this.policy = inspectTest(this.state);
    this.keys.forEach(key => this.history.mark(key));
  }

  change(): void {
    this.policy = changePolicy(this.state);
  }

  lock(temperature: number, threshold: number, split: Split, group?: string, evaluationFailure?: string | null): void {
    if (split !== "policy_validation" || !this.counts.policy_validation || group || evaluationFailure) {
      throw new Error("Lock a policy on the full policy-validation split after a successful assessment.");
    }
    if (!Number.isFinite(temperature) || temperature <= 0 || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      throw new Error("A policy requires a positive finite temperature and a threshold from 0 to 1.");
    }
    this.policy = lockPolicy(this.state, temperature, threshold);
  }

  exposeSourceRows(explicitChoice: boolean): void {
    if (!explicitChoice) throw new Error("Including source rows requires an explicit disclosure choice.");
    if (this.counts.test) this.reviewTest();
  }

  status(split: Split, group?: string): string {
    return assessmentStatus(this.state, split, this.counts.policy_validation > 0, group);
  }
}
