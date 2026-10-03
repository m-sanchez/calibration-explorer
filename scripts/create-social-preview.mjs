import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({
  options: {
    site: { type: "string", default: resolve(root, "../PersonalSite") },
    "serif-font": { type: "string", default: "C:/Windows/Fonts/cambria.ttc" },
    python: { type: "string", default: "python" },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(
    "Usage: node scripts/create-social-preview.mjs [--site PATH] [--serif-font PATH] [--python COMMAND]\n" +
      "Uses the existing PersonalSite satori and sharp installation, Python fontTools, and a local serif font.\n" +
      "Writes a 1280x640 SVG with outlined text and a 2560x1280 PNG to docs/assets. No font files are copied.",
  );
  process.exit(0);
}

const require = createRequire(resolve(values.site, "package.json"));
const satori = require("satori").default;
const sharp = require("sharp");
const convertFont = `
from io import BytesIO
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
font = TTFont(sys.argv[1], fontNumber=0)
if "fvar" in font:
    font = instantiateVariableFont(font, {"wght": int(sys.argv[2])}, inplace=True)
font.flavor = None
output = BytesIO()
font.save(output)
sys.stdout.buffer.write(output.getvalue())
`;
const font = (path, weight = 400) =>
  execFileSync(values.python, ["-c", convertFont, path, String(weight)], {
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });

const element = (type, style, children, props = {}) => ({
  type,
  props: { ...props, style, children },
});
const text = (value, style) => element("div", { display: "flex", ...style }, value);
const card = element(
  "div",
  {
    display: "flex",
    position: "relative",
    width: 1280,
    height: 640,
    backgroundColor: "#fdfcfa",
    color: "#403424",
    fontFamily: "Inter",
  },
  [
    element(
      "svg",
      { position: "absolute", left: 92, top: 106 },
      [
        element("path", {}, undefined, {
          d: "M7 12 17 6.5M7 12l10 5.5",
          stroke: "#f0ad3d",
          strokeWidth: 1.7,
          fill: "none",
        }),
        element("circle", {}, undefined, {
          cx: 7,
          cy: 12,
          r: 2.1,
          fill: "#f0ad3d",
        }),
        element("circle", {}, undefined, {
          cx: 17.5,
          cy: 6.2,
          r: 2.1,
          fill: "#f0ad3d",
        }),
        element("circle", {}, undefined, {
          cx: 17.5,
          cy: 17.8,
          r: 2.1,
          fill: "none",
          stroke: "#9c4a2e",
          strokeWidth: 1.7,
        }),
      ],
      { width: 44, height: 44, viewBox: "0 0 24 24" },
    ),
    text("Calibration Explorer", {
      position: "absolute",
      left: 152,
      top: 82,
      fontFamily: "Site Serif",
      fontSize: 72,
      fontWeight: 400,
      lineHeight: 1.2,
      letterSpacing: "-0.006em",
    }),
    element("div", {
      position: "absolute",
      left: 92,
      top: 185,
      width: 1096,
      height: 1,
      backgroundColor: "rgba(64, 52, 36, 0.22)",
    }),
    element(
      "div",
      {
        display: "flex",
        flexDirection: "column",
        position: "absolute",
        left: 92,
        top: 222,
        fontSize: 31,
        lineHeight: 1.55,
        color: "#5b4c37",
      },
      [
        text("Analyse classifier confidence from your own predictions."),
        text("CSV and JSON imports. Calibration, thresholds, and reports."),
      ],
    ),
    text("miguelsanchez.co.uk", {
      position: "absolute",
      left: 92,
      top: 535,
      fontFamily: "JetBrains Mono",
      fontSize: 22,
      color: "#6b5b42",
    }),
  ],
);

let svg = await satori(card, {
  width: 1280,
  height: 640,
  embedFont: true,
  fonts: [
    { name: "Site Serif", data: font(values["serif-font"]), weight: 400 },
    {
      name: "Inter",
      data: font(resolve(root, "public/fonts/inter-latin-wght.woff2")),
      weight: 400,
    },
    {
      name: "JetBrains Mono",
      data: font(resolve(root, "public/fonts/jetbrains-mono-latin-wght.woff2")),
      weight: 400,
    },
  ],
});
svg = svg.replace("<svg ", '<svg role="img" aria-labelledby="card-title card-description" ');
svg = svg.replace(
  /(<svg\b[^>]*>)/u,
  '$1<title id="card-title">Calibration Explorer</title><desc id="card-description">Analyse classifier confidence from your own predictions. CSV and JSON imports. Calibration, thresholds, and reports. miguelsanchez.co.uk</desc>',
);
const output = resolve(root, "docs/assets");
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "social-preview.svg"), svg);
await sharp(Buffer.from(svg), { density: 144 })
  .png()
  .toFile(resolve(output, "social-preview.png"));
console.log("Wrote docs/assets/social-preview.svg (1280x640) and social-preview.png (2560x1280).");
