import {
  calibrationError,
  fitTemperature,
  nll,
  reliabilityDiagram,
  toPredictions,
} from "@m-sanchez/calibrated";
import type { LogitSample, TemperatureFit } from "@m-sanchez/calibrated";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 20_000;
export const MAX_CLASSES = 100;
export const MAX_TOTAL_LOGITS = 1_000_000;
export const MAX_TEXT_LENGTH = 512;
export const MAX_BINS = 100;
export const SPLITS = [
  "calibration",
  "policy_validation",
  "test",
  "exploration",
] as const;

export type Split = (typeof SPLITS)[number];
export type Strategy = "equal-width" | "equal-mass";

export interface Row {
  id: string;
  split: Split;
  group?: string;
  confidence?: number;
  correct?: boolean;
  logits?: number[];
  label?: number;
}

export interface Dataset {
  schemaVersion: 1;
  name: string;
  kind: "confidence" | "logits";
  classes?: string[];
  provenance: Record<string, unknown>;
  rows: Row[];
}

export interface Prediction {
  id: string;
  confidence: number;
  correct: boolean;
  group?: string;
}

export interface AnalysisBin {
  range: [number, number];
  count: number;
  confidence: number | null;
  accuracy: number | null;
  gap: number | null;
  contribution: number;
}

export interface Analysis {
  n: number;
  accuracy: number | null;
  meanConfidence: number | null;
  ece: number | null;
  nll: number | null;
  bins: AnalysisBin[];
  predictions: Prediction[];
}

export interface Risk {
  accepted: number;
  abstained: number;
  errors: number;
  coverage: number | null;
  risk: number | null;
}

export interface RiskPoint {
  threshold: number | null;
  coverage: number | null;
  risk: number | null;
  accepted: number;
  errors: number;
}

type RawRow = { value: Record<string, unknown>; location: string };
type CsvRecord = { cells: string[]; line: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, field: string, location: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${location}: ${field} must be a nonempty string.`);
  }
  if (
    value.length > MAX_TEXT_LENGTH ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(value)
  ) {
    throw new Error(
      `${location}: ${field} must be at most ${MAX_TEXT_LENGTH} characters with no control characters.`,
    );
  }
  return value.trim();
}

function finiteNumber(
  value: unknown,
  field: string,
  location: string,
  csv: boolean,
): number {
  const numeric =
    csv &&
    typeof value === "string" &&
    /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value.trim())
      ? Number(value.trim())
      : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) {
    throw new Error(`${location}: ${field} must be a finite number.`);
  }
  return numeric;
}

function probability(
  value: unknown,
  field: string,
  location: string,
  csv = false,
): number {
  const numeric = finiteNumber(value, field, location, csv);
  if (numeric < 0 || numeric > 1) {
    throw new Error(
      `${location}: ${field} must be between 0 and 1, inclusive.`,
    );
  }
  return numeric;
}

function booleanValue(value: unknown, location: string, csv: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (csv && typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  throw new Error(
    `${location}: correct must be ${csv ? "true, false, 1, or 0" : "a boolean (true or false)"}.`,
  );
}

function splitValue(
  value: unknown,
  location: string,
  required: boolean,
): Split {
  if (!required && (value === undefined || value === "")) return "exploration";
  if (
    typeof value === "string" &&
    (SPLITS as readonly string[]).includes(value.trim())
  ) {
    return value.trim() as Split;
  }
  throw new Error(
    `${location}: split must be one of ${SPLITS.join(", ")}${required ? "; logits require an explicit split" : ""}.`,
  );
}

function onlyFields(
  value: Record<string, unknown>,
  allowed: string[],
  location: string,
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined)
    throw new Error(`${location}: unsupported field "${unexpected}".`);
}

function parseCsv(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  let line = 1;
  let startLine = 1;
  let touched = false;
  const finishField = () => {
    cells.push(field);
    field = "";
    closedQuote = false;
  };
  const finishRecord = () => {
    finishField();
    if (records.length > MAX_ROWS)
      throw new Error(
        `CSV contains more than ${MAX_ROWS.toLocaleString("en-US")} data rows.`,
      );
    records.push({ cells, line: startLine });
    cells = [];
    touched = false;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += char;
        if (char === "\n" || (char === "\r" && text[i + 1] !== "\n")) line++;
      }
      continue;
    }
    if (closedQuote && char !== "," && char !== "\r" && char !== "\n") {
      throw new Error(
        `CSV row ${line}: unexpected character after a closing quote; use a comma or line ending.`,
      );
    }
    if (char === '"') {
      if (field.length > 0)
        throw new Error(
          `CSV row ${line}: a quote must begin a field; escape an embedded quote as "".`,
        );
      quoted = true;
      touched = true;
    } else if (char === ",") {
      finishField();
      touched = true;
    } else if (char === "\n" || char === "\r") {
      finishRecord();
      if (char === "\r" && text[i + 1] === "\n") i++;
      line++;
      startLine = line;
    } else {
      field += char;
      touched = true;
    }
  }
  if (quoted) throw new Error(`CSV row ${startLine}: unclosed quoted field.`);
  if (touched || closedQuote || field.length > 0 || cells.length > 0)
    finishRecord();
  return records;
}

function csvRows(text: string): RawRow[] {
  const records = parseCsv(text);
  if (records.length < 2)
    throw new Error("CSV must contain a header and at least one data row.");
  const headers = records[0].cells.map((header) => header.trim());
  if (new Set(headers).size !== headers.length)
    throw new Error("CSV header contains duplicate column names.");
  const allowed = ["id", "confidence", "correct", "split", "group"];
  for (const header of headers) {
    if (!allowed.includes(header))
      throw new Error(
        `CSV header: unsupported column "${header}". Use ${allowed.join(", ")}.`,
      );
  }
  for (const required of ["id", "confidence", "correct"]) {
    if (!headers.includes(required))
      throw new Error(`CSV header is missing required column "${required}".`);
  }
  return records.slice(1).map(({ cells, line }) => {
    if (cells.length !== headers.length) {
      throw new Error(
        `CSV row ${line}: expected ${headers.length} columns, found ${cells.length}; quote fields containing commas.`,
      );
    }
    return {
      value: Object.fromEntries(
        headers.map((header, index) => [header, cells[index]]),
      ),
      location: `CSV row ${line}`,
    };
  });
}

export function parseDataset(text: string, filename: string): Dataset {
  if (
    text.length > MAX_IMPORT_BYTES ||
    new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES
  ) {
    throw new Error(
      `File exceeds the ${MAX_IMPORT_BYTES / 1024 / 1024} MiB import limit.`,
    );
  }
  const source = text.replace(/^\uFEFF/u, "");
  const csv = /\.csv$/iu.test(filename);
  if (!csv && !/\.json$/iu.test(filename))
    throw new Error("Choose a .csv or .json file.");
  let name = filename.replace(/^.*[\\/]/u, "").replace(/\.[^.]+$/u, "");
  let provenance: Record<string, unknown> = { source: filename };
  let classes: string[] | undefined;
  let declaredKind: unknown;
  let rawRows: RawRow[];
  if (csv) {
    rawRows = csvRows(source);
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch (error) {
      throw new Error(
        `Invalid JSON: ${error instanceof Error ? error.message : "check the file syntax"}`,
      );
    }
    let raw: unknown[];
    if (Array.isArray(parsed)) {
      raw = parsed;
    } else {
      if (!isRecord(parsed))
        throw new Error("JSON must be a dataset object or an array of rows.");
      onlyFields(
        parsed,
        ["schemaVersion", "name", "kind", "classes", "provenance", "rows"],
        "Dataset",
      );
      if (parsed.schemaVersion !== 1)
        throw new Error("Dataset: schemaVersion must be 1.");
      name = stringValue(parsed.name, "name", "Dataset");
      if (!Array.isArray(parsed.rows))
        throw new Error("Dataset: rows must be an array.");
      raw = parsed.rows;
      declaredKind = parsed.kind;
      if (parsed.provenance !== undefined) {
        if (!isRecord(parsed.provenance))
          throw new Error("Dataset: provenance must be an object.");
        provenance = parsed.provenance;
      }
      if (parsed.classes !== undefined) {
        if (
          !Array.isArray(parsed.classes) ||
          parsed.classes.length < 2 ||
          parsed.classes.length > MAX_CLASSES
        ) {
          throw new Error(
            `Dataset: classes must contain between 2 and ${MAX_CLASSES} class names.`,
          );
        }
        classes = parsed.classes.map((value, index) =>
          stringValue(value, `classes[${index}]`, "Dataset"),
        );
        if (new Set(classes).size !== classes.length)
          throw new Error("Dataset: class names must be unique.");
      }
    }
    rawRows = raw.map((value, index) => {
      const location = `JSON row ${index + 1}`;
      if (!isRecord(value))
        throw new Error(`${location}: each row must be an object.`);
      return { value, location };
    });
  }
  if (rawRows.length === 0)
    throw new Error("Dataset must contain at least one row.");
  if (rawRows.length > MAX_ROWS)
    throw new Error(
      `Dataset exceeds the ${MAX_ROWS.toLocaleString("en-US")} row limit.`,
    );
  name = stringValue(name, "name", "Dataset");
  const kind = rawRows[0].value.logits !== undefined ? "logits" : "confidence";
  if (declaredKind !== undefined && declaredKind !== kind)
    throw new Error(`Dataset: kind must match its ${kind} rows.`);
  let dimension: number | undefined;
  let totalLogits = 0;
  const ids = new Map<string, string>();
  const rows = rawRows.map(({ value, location }): Row => {
    onlyFields(
      value,
      ["id", "split", "group", "confidence", "correct", "logits", "label"],
      location,
    );
    const id = stringValue(value.id, "id", location);
    if (ids.has(id))
      throw new Error(
        `${location}: duplicate id "${id}"; it was already used at ${ids.get(id)}. IDs must be unique across splits.`,
      );
    ids.set(id, location);
    const split = splitValue(value.split, location, kind === "logits");
    const group =
      value.group === undefined || value.group === ""
        ? undefined
        : stringValue(value.group, "group", location);
    const row: Row = { id, split, ...(group === undefined ? {} : { group }) };
    if (kind === "confidence") {
      if (value.logits !== undefined || value.label !== undefined)
        throw new Error(
          `${location}: cannot mix confidence rows and logit rows.`,
        );
      return {
        ...row,
        confidence: probability(value.confidence, "confidence", location, csv),
        correct: booleanValue(value.correct, location, csv),
      };
    }
    if (value.confidence !== undefined || value.correct !== undefined)
      throw new Error(
        `${location}: logits determine confidence and correctness; remove confidence and correct fields.`,
      );
    if (
      !Array.isArray(value.logits) ||
      value.logits.length < 2 ||
      value.logits.length > MAX_CLASSES
    ) {
      throw new Error(
        `${location}: logits must contain between 2 and ${MAX_CLASSES} finite numbers.`,
      );
    }
    if (dimension !== undefined && value.logits.length !== dimension)
      throw new Error(
        `${location}: expected ${dimension} logits, found ${value.logits.length}; class dimensions must match across all rows.`,
      );
    dimension = value.logits.length;
    if (classes !== undefined && classes.length !== dimension)
      throw new Error(
        `${location}: ${dimension} logits do not match the ${classes.length} declared classes.`,
      );
    totalLogits += dimension;
    if (totalLogits > MAX_TOTAL_LOGITS)
      throw new Error(
        `Dataset exceeds the ${MAX_TOTAL_LOGITS.toLocaleString("en-US")} total-logit limit.`,
      );
    const logits = value.logits.map((entry, index) =>
      finiteNumber(entry, `logits[${index}]`, location, false),
    );
    const label = finiteNumber(value.label, "label", location, false);
    if (!Number.isInteger(label) || label < 0 || label >= dimension) {
      throw new Error(
        `${location}: label must be a zero-based integer from 0 to ${dimension - 1}.`,
      );
    }
    return { ...row, logits, label };
  });
  return {
    schemaVersion: 1,
    name,
    kind,
    provenance,
    rows,
    ...(classes === undefined ? {} : { classes }),
  };
}

function logitSamples(rows: Row[]): LogitSample[] {
  return rows.map((row) => {
    if (!row.logits || row.label === undefined)
      throw new Error(`Row "${row.id}" is missing logits or its class label.`);
    return { logits: row.logits, label: row.label };
  });
}

export function analyze(
  dataset: Dataset,
  options: {
    split: Split;
    bins: number;
    strategy: Strategy;
    temperature?: number;
    group?: string;
  },
): Analysis {
  const { bins, strategy, group } = options;
  const split = splitValue(options.split, "Analysis", true);
  if (!Number.isInteger(bins) || bins < 1 || bins > MAX_BINS)
    throw new Error(`Analysis: bins must be an integer from 1 to ${MAX_BINS}.`);
  if (strategy !== "equal-width" && strategy !== "equal-mass")
    throw new Error("Analysis: strategy must be equal-width or equal-mass.");
  const temperature = options.temperature ?? 1;
  if (!Number.isFinite(temperature) || temperature <= 0)
    throw new Error("Analysis: temperature must be a finite positive number.");
  if (dataset.kind === "confidence" && temperature !== 1)
    throw new Error(
      "Temperature scaling requires logits; confidence-only data cannot be recalibrated.",
    );
  const rows = dataset.rows.filter(
    (row) =>
      row.split === split && (group === undefined || row.group === group),
  );
  const samples = dataset.kind === "logits" ? logitSamples(rows) : null;
  const values =
    samples !== null
      ? toPredictions(samples, temperature)
      : rows.map((row) => ({
          confidence: probability(
            row.confidence,
            "confidence",
            `Row "${row.id}"`,
          ),
          correct: booleanValue(row.correct, `Row "${row.id}"`, false),
        }));
  const predictions: Prediction[] = values.map((value, index) => ({
    ...value,
    id: rows[index].id,
    ...(rows[index].group === undefined ? {} : { group: rows[index].group }),
  }));
  const n = predictions.length;
  const result = calibrationError(predictions, bins, strategy);
  const diagram = reliabilityDiagram(predictions, bins, strategy).map(
    (item): AnalysisBin => ({
      ...item,
      confidence: item.count ? item.confidence : null,
      accuracy: item.count ? item.accuracy : null,
      gap: item.count ? item.gap : null,
      contribution: n > 0 ? (item.count / n) * item.gap : 0,
    }),
  );
  return {
    n,
    accuracy:
      n > 0
        ? predictions.filter((prediction) => prediction.correct).length / n
        : null,
    meanConfidence:
      n > 0
        ? predictions.reduce(
            (sum, prediction) => sum + prediction.confidence,
            0,
          ) / n
        : null,
    ece: n > 0 ? result.ece : null,
    nll: n > 0 && samples !== null ? nll(samples, temperature) : null,
    bins: diagram,
    predictions,
  };
}

function validatePredictions(predictions: Prediction[]): void {
  for (const prediction of predictions) {
    probability(
      prediction.confidence,
      "confidence",
      `Prediction "${prediction.id}"`,
    );
    booleanValue(prediction.correct, `Prediction "${prediction.id}"`, false);
  }
}

export function getRisk(predictions: Prediction[], threshold: number): Risk {
  probability(threshold, "threshold", "Risk");
  validatePredictions(predictions);
  let accepted = 0;
  let errors = 0;
  for (const prediction of predictions) {
    if (prediction.confidence >= threshold) {
      accepted++;
      if (!prediction.correct) errors++;
    }
  }
  return {
    accepted,
    abstained: predictions.length - accepted,
    errors,
    coverage: predictions.length > 0 ? accepted / predictions.length : null,
    risk: accepted > 0 ? errors / accepted : null,
  };
}

export function riskCurve(predictions: Prediction[]): RiskPoint[] {
  validatePredictions(predictions);
  const sorted = [...predictions].sort((a, b) => b.confidence - a.confidence);
  const points: RiskPoint[] = [
    {
      threshold: null,
      coverage: sorted.length ? 0 : null,
      risk: null,
      accepted: 0,
      errors: 0,
    },
  ];
  let accepted = 0;
  let errors = 0;
  while (accepted < sorted.length) {
    const threshold = sorted[accepted].confidence;
    do {
      if (!sorted[accepted].correct) errors++;
      accepted++;
    } while (
      accepted < sorted.length &&
      sorted[accepted].confidence === threshold
    );
    points.push({
      threshold,
      coverage: accepted / sorted.length,
      risk: errors / accepted,
      accepted,
      errors,
    });
  }
  return points;
}

export function fitDataset(dataset: Dataset): TemperatureFit {
  if (dataset.kind !== "logits")
    throw new Error(
      "Temperature fitting requires raw logits and class labels.",
    );
  const calibrationRows = dataset.rows.filter(
    (row) => row.split === "calibration",
  );
  if (calibrationRows.length === 0)
    throw new Error(
      'Temperature fitting requires at least one row with split "calibration"; test and policy_validation rows are never used for fitting.',
    );
  return fitTemperature(logitSamples(calibrationRows));
}
