import { nullEce, softmax } from "@m-sanchez/calibrated";
import type { NullEce } from "@m-sanchez/calibrated";
import { analyze } from "./domain.ts";
import type { Dataset, Row, Split, Strategy } from "./domain.ts";

export type LearningKind =
  "sampling" | "binning" | "temperature" | "group-failure";

export interface LearningOptions {
  n: 100 | 500 | 2000;
  seed: number;
  redraw: number;
  distortion: number;
}

export interface ReferenceOptions {
  split: Split;
  group?: string;
  bins: number;
  strategy: Strategy;
  temperature?: number;
  iterations?: number;
  seed?: number;
}

export type ConditionalReference = Omit<NullEce, "median" | "mean" | "p95"> & {
  median: number | null;
  mean: number | null;
  p95: number | null;
  seed: number;
};

type PartitionSeeds = { logits: number; labels: number };

interface LearningProvenance {
  version: 1;
  kind: LearningKind;
  options: LearningOptions;
  generator: string;
  seeds: Record<string, number | PartitionSeeds>;
  splitSizes: Partial<Record<Split, number>>;
  oracleTemperature?: number;
  oracleTemperatures?: Record<string, number>;
  limitations: string[];
}

const DEFAULTS: LearningOptions = {
  n: 500,
  seed: 42,
  redraw: 0,
  distortion: 2.5,
};
const LOGIT_SPLITS = ["calibration", "policy_validation", "test"] as const;
const CLASSES = ["Class A", "Class B", "Class C", "Class D"];

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

export function normalizeLearningOptions(
  options: Partial<LearningOptions> = {},
): LearningOptions {
  return {
    n:
      options.n === 100 || options.n === 500 || options.n === 2000
        ? options.n
        : DEFAULTS.n,
    seed: boundedInteger(options.seed, 0, 0xffffffff)
      ? options.seed
      : DEFAULTS.seed,
    redraw: boundedInteger(options.redraw, 0, 1_000_000)
      ? options.redraw
      : DEFAULTS.redraw,
    distortion:
      typeof options.distortion === "number" &&
      Number.isFinite(options.distortion) &&
      options.distortion >= 0.25 &&
      options.distortion <= 6
        ? options.distortion
        : DEFAULTS.distortion,
  };
}

function streamSeed(seed: number, stream: string): number {
  let value = (seed ^ 0x811c9dc5) >>> 0;
  for (let index = 0; index < stream.length; index++) {
    value = Math.imul(value ^ stream.charCodeAt(index), 0x01000193) >>> 0;
  }
  return value;
}

function randomStream(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

function dataset(
  name: string,
  kind: Dataset["kind"],
  rows: Row[],
  learning: LearningProvenance,
): Dataset {
  return {
    schemaVersion: 1,
    name,
    kind,
    ...(kind === "logits" ? { classes: [...CLASSES] } : {}),
    provenance: {
      source: "Synthetic educational example",
      synthetic: true,
      learning,
    },
    rows,
  };
}

function sampling(options: LearningOptions): Dataset {
  const seeds = {
    confidence: streamSeed(options.seed, "sampling/confidence"),
    outcomes: streamSeed(options.seed, `sampling/outcomes/${options.redraw}`),
  };
  const confidenceRandom = randomStream(seeds.confidence);
  const outcomeRandom = randomStream(seeds.outcomes);
  const rows = Array.from({ length: options.n }, (_, index): Row => {
    const confidence = 0.5 + confidenceRandom() * 0.5;
    return {
      id: `sampling-${index + 1}`,
      split: "exploration",
      confidence,
      correct: outcomeRandom() < confidence,
    };
  });
  return dataset(
    "Sampling noise with calibrated predictions",
    "confidence",
    rows,
    {
      version: 1,
      kind: "sampling",
      options,
      generator:
        "Fixed confidences uniform on [0.5, 1); independent Bernoulli outcomes with success probability equal to confidence",
      seeds,
      splitSizes: { exploration: options.n },
      limitations: [
        "Synthetic outcomes are calibrated by construction; finite samples need not have zero measured ECE.",
        "Redrawing outcomes preserves the confidence values. Increasing sample size preserves the existing prefix.",
        "A conditional simulated reference is descriptive, not a universal threshold or a deployment decision.",
      ],
    },
  );
}

function binning(options: LearningOptions): Dataset {
  const rows = Array.from({ length: 20 }, (_, index): Row => ({
    id: `binning-${index + 1}`,
    split: "exploration",
    confidence: index < 10 ? 0.6 : 0.9,
    correct: index < 10 ? index < 8 : index < 17,
  }));
  return dataset("When bins cancel opposing errors", "confidence", rows, {
    version: 1,
    kind: "binning",
    options,
    generator:
      "Exact 20-row fixture: ten predictions at 0.6 confidence with eight correct; ten at 0.9 confidence with seven correct",
    seeds: {},
    splitSizes: { exploration: 20 },
    limitations: [
      "This hand-constructed fixture illustrates cancellation inside a coarse bin; it is not an empirical model result.",
      "The twenty rows remain fixed across all sample-size, seed, redraw, and distortion controls.",
    ],
  });
}

function normal(random: () => number): number {
  return (
    Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())
  );
}

function categorical(probabilities: number[], random: () => number): number {
  const draw = random();
  let cumulative = 0;
  for (let index = 0; index < probabilities.length - 1; index++) {
    cumulative += probabilities[index];
    if (draw < cumulative) return index;
  }
  return probabilities.length - 1;
}

function logitDataset(
  kind: "temperature" | "group-failure",
  options: LearningOptions,
): Dataset {
  const seeds: Record<string, PartitionSeeds> = {};
  const strengths = {
    "mild-distortion": options.distortion * 0.4,
    "strong-distortion": options.distortion * 1.6,
  };
  const rows: Row[] = [];
  for (const split of LOGIT_SPLITS) {
    const partition = {
      logits: streamSeed(options.seed, `${kind}/${split}/logits`),
      labels: streamSeed(
        options.seed,
        `${kind}/${split}/labels/${options.redraw}`,
      ),
    };
    seeds[split] = partition;
    const logitRandom = randomStream(partition.logits);
    const labelRandom = randomStream(partition.labels);
    for (let index = 0; index < options.n; index++) {
      const latent = CLASSES.map(() => normal(logitRandom) * 1.2);
      const group =
        kind === "group-failure"
          ? index % 2 === 0
            ? "mild-distortion"
            : "strong-distortion"
          : undefined;
      const strength =
        group === undefined ? options.distortion : strengths[group];
      rows.push({
        id: `${kind}-${split}-${index + 1}`,
        split,
        ...(group === undefined ? {} : { group }),
        logits: latent.map((value) => value * strength),
        label: categorical(softmax(latent), labelRandom),
      });
    }
  }
  return dataset(
    kind === "temperature"
      ? "Temperature scaling with a known correction"
      : "One temperature across different groups",
    "logits",
    rows,
    {
      version: 1,
      kind,
      options,
      generator:
        "Four independent Gaussian latent logits with standard deviation 1.2; labels sampled from their softmax; logits then multiplied by the recorded positive distortion",
      seeds,
      splitSizes: {
        calibration: options.n,
        policy_validation: options.n,
        test: options.n,
      },
      ...(kind === "temperature"
        ? { oracleTemperature: options.distortion }
        : { oracleTemperatures: strengths }),
      limitations: [
        "Synthetic labels are sampled before distortion. The known oracle temperature is a property of this generator, not an estimate from held-out labels.",
        "Calibration, policy-validation, and test partitions use separate seeded pseudorandom streams. Only calibration rows may be used to fit a temperature.",
        ...(kind === "group-failure"
          ? [
              "Groups have different oracle temperatures. One global temperature cannot exactly undo both distortions.",
              "Aggregate and group metrics may improve or worsen on finite samples; this preset does not guarantee harm in either group.",
            ]
          : [
              "A fitted temperature and held-out metrics fluctuate with the sample; recovery of the oracle is not exact or guaranteed.",
            ]),
      ],
    },
  );
}

export function createLearningDataset(
  kind: LearningKind,
  options: Partial<LearningOptions> = {},
): Dataset {
  const normalized = normalizeLearningOptions(options);
  if (kind === "sampling") return sampling(normalized);
  if (kind === "binning") return binning(normalized);
  if (kind === "temperature" || kind === "group-failure")
    return logitDataset(kind, normalized);
  throw new Error("Unknown learning example.");
}

export function conditionalReference(
  data: Dataset,
  options: ReferenceOptions,
): ConditionalReference {
  const count = data.rows.filter(
    (row) =>
      row.split === options.split &&
      (options.group === undefined || row.group === options.group),
  ).length;
  if (count > 2000)
    throw new Error(
      "Conditional calibration reference supports at most 2,000 selected rows; choose a smaller split or group.",
    );
  const iterations =
    typeof options.iterations === "number" &&
    Number.isFinite(options.iterations)
      ? Math.max(200, Math.min(1000, Math.round(options.iterations)))
      : 500;
  const seed = boundedInteger(options.seed, 0, 0xffffffff)
    ? options.seed
    : DEFAULTS.seed;
  const result = analyze(data, options);
  if (result.n === 0) {
    return {
      median: null,
      mean: null,
      p95: null,
      n: 0,
      bins: options.bins,
      strategy: options.strategy,
      iterations,
      seed,
    };
  }
  return {
    ...nullEce({
      confidences: result.predictions.map(
        (prediction) => prediction.confidence,
      ),
      bins: options.bins,
      strategy: options.strategy,
      iterations,
      seed,
    }),
    seed,
  };
}
