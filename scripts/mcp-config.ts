import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const values = new Map<string, string>();
for (let i = 0; i < args.length; i += 2) {
  if (!["--input-root", "--output-root", "--output"].includes(args[i]) || !args[i + 1] || values.has(args[i])) throw new Error("Use --input-root DIRECTORY --output-root DIRECTORY --output NEW_CONFIG_FILE.");
  values.set(args[i], args[i + 1]);
}
if (values.size !== 3) throw new Error("Use --input-root DIRECTORY --output-root DIRECTORY --output NEW_CONFIG_FILE.");
const input = await realpath(resolve(values.get("--input-root")!));
const output = resolve(values.get("--output-root")!);
await mkdir(output, { recursive: true });
const configPath = resolve(values.get("--output")!);
await mkdir(dirname(configPath), { recursive: true });
const config = { mcpServers: { calibration: { type: "stdio", command: process.execPath, args: [fileURLToPath(new URL("../mcp/cli.ts", import.meta.url)), "--input-root", input, "--output-root", await realpath(output)] } } };
await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", { flag: "wx" });
process.stdout.write(`Created ${configPath}\nLaunch Claude Code 2.1.283: claude --mcp-config "${configPath}" --strict-mcp-config\n`);
