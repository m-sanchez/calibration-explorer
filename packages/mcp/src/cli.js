import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createCalibrationServer } from "../../../mcp/server.ts";
import { version } from "../package.json";

const usage = "Usage: calibration-explorer-mcp --input-root ABSOLUTE_DIRECTORY --output-root ABSOLUTE_DIRECTORY";
const help = `calibration-explorer-mcp ${version}

Local stdio MCP server for Calibration Explorer. It measures whether saved
classifier confidence matches observed accuracy, fits temperature on
calibration rows, locks a threshold on policy-validation rows and writes
assessment reports. It does not train or run a classifier.

${usage}

Options:
  --input-root DIRECTORY   Existing directory whose prediction files may be read. Repeatable.
  --output-root DIRECTORY  Existing directory where new report folders may be created. Repeatable.
  --help, -h               Print this help and exit.
  --version                Print the version and exit.

Run it from an MCP client over stdin/stdout. Paths outside the configured
roots are refused and existing files are never overwritten.
Documentation: https://github.com/m-sanchez/calibration-explorer/blob/main/docs/mcp.md
`;

const inputRoots = [];
const outputRoots = [];
const args = process.argv.slice(2);
let info = null;
try {
  for (let i = 0; i < args.length && !info; i += 2) {
    if (args[i] === "--help" || args[i] === "-h") info = help;
    else if (args[i] === "--version") info = `${version}\n`;
    else {
      const target = args[i] === "--input-root" ? inputRoots : args[i] === "--output-root" ? outputRoots : null;
      if (!target || !args[i + 1]) throw new Error(usage);
      target.push(args[i + 1]);
    }
  }
  if (info) process.stdout.write(info);
  else {
    const server = await createCalibrationServer({ inputRoots, outputRoots });
    await server.connect(new StdioServerTransport());
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Unable to start Calibration Explorer MCP."}\n`);
  process.exitCode = 1;
}
