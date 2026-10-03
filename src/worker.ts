import { type Dataset, type Split } from "./domain.ts";
import { assessDataset } from "./assessment.ts";
import { conditionalReference } from "./learning.ts";
import { attemptFit } from "./fit.ts";

self.onmessage = (event: MessageEvent) => {
  const { id, type, dataset, options } = event.data as {
    id: number;
    type: string;
    dataset: Dataset;
    options: {
      split: Split;
      bins: number;
      strategy: "equal-width" | "equal-mass";
      temperature: number;
      applyTemperature: boolean;
      group?: string;
    };
  };
  try {
    if (type === "fit") {
      self.postMessage({ id, attempt: attemptFit(dataset) });
      return;
    }
    if (type === "reference") {
      self.postMessage({
        id,
        reference: conditionalReference(dataset, options),
      });
      return;
    }
    self.postMessage({ id, ...assessDataset(dataset, options) });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
