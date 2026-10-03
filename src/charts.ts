export interface ChartBin {
  range: [number, number];
  count: number;
  confidence: number | null;
  accuracy: number | null;
  gap: number | null;
  contribution: number;
}

export const escapeHtml = (value: unknown): string =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const percent = (value: number | null, digits = 1): string =>
  value === null || !Number.isFinite(value)
    ? "Unavailable"
    : `${(value * 100).toFixed(digits)}%`;
export const decimal = (value: number | null, digits = 4): string =>
  value === null || !Number.isFinite(value)
    ? "Unavailable"
    : value.toFixed(digits);

export function reliabilitySvg(
  before: ChartBin[],
  after: ChartBin[] | null,
  selected: number,
  series: string,
  interactive = true,
): string {
  const left = 65,
    top = 26,
    width = 500,
    height = 298;
  const x = (v: number) => left + v * width,
    y = (v: number) => top + (1 - v) * height;
  const grid = [0, 0.2, 0.4, 0.6, 0.8, 1]
    .map(
      (v) =>
        `<line x1="${left}" y1="${y(v)}" x2="${left + width}" y2="${y(v)}" class="gridline"/><text x="${left - 12}" y="${y(v) + 4}" text-anchor="end" class="tick">${Math.round(v * 100)}%</text><text x="${x(v)}" y="${top + height + 25}" text-anchor="middle" class="tick">${Math.round(v * 100)}%</text>`,
    )
    .join("");
  const render = (bins: ChartBin[], name: string) =>
    bins
      .map((b, index) => {
        if (!b.count || b.confidence === null || b.accuracy === null) return "";
        const label = `${name === "after" ? "After scaling" : "Original"}, bin ${index + 1}: ${b.count} predictions, confidence ${percent(b.confidence)}, accuracy ${percent(b.accuracy)}, ECE contribution ${decimal(b.contribution)}`;
        const radius = selected === index && series === name ? 8 : 5,
          px = x(b.confidence),
          py = y(b.accuracy);
        const marker =
          name === "after"
            ? `<path class="marker" d="M${px} ${py - radius - 1}l${radius + 1} ${radius + 1}l-${radius + 1} ${radius + 1}l-${radius + 1} -${radius + 1}Z"/>`
            : `<circle class="marker" cx="${px}" cy="${py}" r="${radius}"/>`;
        return `<g class="bin-point ${name} ${selected === index && series === name ? "selected" : ""}" ${interactive ? `data-bin="${index}" data-series="${name}" role="button" tabindex="0" aria-pressed="${selected === index && series === name}" aria-label="${escapeHtml(label)}"` : ""}><title>${escapeHtml(label)}</title><line x1="${px}" y1="${y(b.confidence)}" x2="${px}" y2="${py}" class="gap-line"/>${marker}<circle cx="${px}" cy="${py}" r="15" class="hit-area"/></g>`;
      })
      .join("");
  return `<svg class="reliability" viewBox="0 0 610 384" role="group" aria-label="${interactive ? "Reliability diagram. Select a populated bin to inspect its contribution to calibration error." : "Reliability diagram showing mean confidence and observed accuracy on shared axes."}">${grid}<line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" class="ideal"/><text x="${x(0.6)}" y="${y(0.6) - 13}" class="ideal-label">Confidence = accuracy</text>${render(before, "before")}${after ? render(after, "after") : ""}<text x="315" y="378" text-anchor="middle" class="axis-label">Mean confidence</text><text transform="translate(16 178) rotate(-90)" text-anchor="middle" class="axis-label">Observed accuracy</text></svg>`;
}

export function riskSvg(
  points: Array<{ coverage: number | null; risk: number | null }>,
  active: { coverage: number | null; risk: number | null },
): string {
  const valid = points.filter(
    (p) => p.coverage !== null && p.risk !== null,
  ) as Array<{ coverage: number; risk: number }>;
  const x = (v: number) => 58 + v * 492,
    y = (v: number) => 22 + (1 - v) * 166;
  const path = valid
    .map(
      (p, i) =>
        `${i ? "H" : "M"}${x(p.coverage)}${i ? `V${y(p.risk)}` : ` ${y(p.risk)}`}`,
    )
    .join(" ");
  return `<svg class="risk-chart" viewBox="0 0 610 245" role="img" aria-label="Observed error rate among accepted predictions versus coverage. Equal-confidence observations are accepted together.">${[0, 0.5, 1].map((v) => `<line class="gridline" x1="58" y1="${y(v)}" x2="550" y2="${y(v)}"/><text x="47" y="${y(v) + 4}" text-anchor="end" class="tick">${v * 100}%</text><text x="${x(v)}" y="210" text-anchor="middle" class="tick">${v * 100}%</text>`).join("")}<path d="${path}" class="risk-path"/>${active.coverage !== null && active.risk !== null ? `<circle cx="${x(active.coverage)}" cy="${y(active.risk)}" r="6" class="risk-active"/>` : ""}<text x="300" y="241" text-anchor="middle" class="axis-label">Coverage · share of predictions accepted</text><text transform="translate(15 107) rotate(-90)" text-anchor="middle" class="axis-label">Error rate</text></svg>`;
}
