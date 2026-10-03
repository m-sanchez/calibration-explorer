import { analyze, riskCurve } from "./domain.ts";
import type { Analysis, Dataset, RiskPoint } from "./domain.ts";

export type AssessmentOptions = Parameters<typeof analyze>[1] & {
  applyTemperature: boolean;
};

export interface DatasetAssessment {
  before: Analysis;
  after: Analysis | null;
  curve: RiskPoint[];
  evaluationFailure: string | null;
}

export function assessDataset(
  dataset: Dataset,
  options: AssessmentOptions,
): DatasetAssessment {
  const before = analyze(dataset, { ...options, temperature: 1 });
  let after: Analysis | null = null;
  let evaluationFailure: string | null = null;
  if (options.applyTemperature) {
    try {
      after = analyze(dataset, options);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      evaluationFailure = `No scaled assessment is available: ${reason} The assessment and acceptance curve use original probabilities (T = 1).`;
    }
  }
  return {
    before,
    after,
    curve: riskCurve((after ?? before).predictions),
    evaluationFailure,
  };
}
