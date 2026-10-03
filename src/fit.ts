import type { TemperatureFit } from "@m-sanchez/calibrated";
import { fitDataset, type Dataset } from "./domain.ts";

export interface FitAttempt {
  status: "applied" | "rejected" | "failed";
  result: TemperatureFit | null;
  calibrationRows: number;
  message: string;
}

export function assessFit(
  result: TemperatureFit,
  calibrationRows: number,
): FitAttempt {
  const valid =
    Number.isFinite(result.temperature) &&
    result.temperature > 0 &&
    Number.isFinite(result.nllBefore) &&
    Number.isFinite(result.nllAfter);
  const applied =
    valid && ["converged", "boundary", "constant"].includes(result.status);
  const message = !valid
    ? "The fitter returned an invalid numerical result. No temperature was applied."
    : result.status === "boundary"
      ? "The fitted temperature reached a search boundary. This does not establish an interior optimum."
      : result.status === "constant"
        ? "The calibration objective is constant. Temperature is unidentifiable and no improvement is established."
        : !applied
          ? `Temperature fitting stopped with status ${result.status}. No temperature was applied; the assessment uses original probabilities.`
          : "Temperature was fitted on calibration observations only. Changes on other splits must be measured separately.";
  return {
    status: applied ? "applied" : "rejected",
    result: valid ? result : null,
    calibrationRows,
    message,
  };
}

export function failedFit(
  calibrationRows: number,
  message: string,
): FitAttempt {
  return {
    status: "failed",
    result: null,
    calibrationRows,
    message: `Temperature fitting failed: ${message} No temperature was applied; the assessment uses original probabilities.`,
  };
}

export function attemptFit(dataset: Dataset): FitAttempt {
  const calibrationRows = dataset.rows.filter(
    (row) => row.split === "calibration",
  ).length;
  try {
    return assessFit(fitDataset(dataset), calibrationRows);
  } catch (error) {
    return failedFit(
      calibrationRows,
      error instanceof Error
        ? error.message
        : "An unexpected calculation error occurred.",
    );
  }
}
