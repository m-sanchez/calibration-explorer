import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = dirname(fileURLToPath(import.meta.url));
function sourceHash(directory: string, entries: string[]): string {
  const files = (path: string): string[] =>
    statSync(path).isDirectory()
      ? readdirSync(path).flatMap((name) => files(join(path, name)))
      : [path];
  const hash = createHash("sha256");
  for (const path of entries
    .flatMap((entry) => files(join(directory, entry)))
    .sort()) {
    hash.update(relative(directory, path).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export default defineConfig({
  define: {
    "import.meta.env.VITE_APP_SOURCE_SHA256": JSON.stringify(
      sourceHash(root, [
        "src",
        "index.html",
        "package.json",
        "package-lock.json",
        "tsconfig.json",
        "vite.config.ts",
      ]),
    ),
    "import.meta.env.VITE_NUMERICAL_DIST_SHA256": JSON.stringify(
      sourceHash(join(root, "node_modules/@m-sanchez/calibrated"), ["dist"]),
    ),
  },
});
