import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createCalibrationServer } from "./server.ts";

const inputRoots: string[] = [];
const outputRoots: string[] = [];
const args = process.argv.slice(2);
try {
  for (let i = 0; i < args.length; i += 2) {
    const target = args[i] === "--input-root" ? inputRoots : args[i] === "--output-root" ? outputRoots : null;
    if (!target || !args[i + 1]) throw new Error("Usage: node mcp/cli.ts --input-root ABSOLUTE_DIRECTORY --output-root ABSOLUTE_DIRECTORY");
    target.push(args[i + 1]);
  }
  const server = await createCalibrationServer({ inputRoots, outputRoots });
  await server.connect(new StdioServerTransport());
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Unable to start Calibration Explorer MCP."}\n`);
  process.exitCode = 1;
}
