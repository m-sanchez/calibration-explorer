# Calibration Explorer MCP

Local stdio MCP server for [Calibration Explorer](https://github.com/m-sanchez/calibration-explorer). It checks whether a classifier's saved confidence matches how often it was correct, fits one temperature on calibration rows, evaluates and locks an acceptance threshold on policy-validation rows, and writes HTML and JSON assessment reports into your project.

It reads prediction files you select, uses the same parser, numerical library, workflow guards and report generator as the browser app, and does not train or run a classifier. There is no telemetry or remote service. Returned summaries can still reach your MCP client's model provider.

## Use with Claude Code

Save this configuration, replacing both directories with absolute paths that already exist:

```json
{
  "mcpServers": {
    "calibration": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y", "@m-sanchez/calibration-explorer-mcp@0.2.0",
        "--input-root", "ABSOLUTE_PREDICTION_DIRECTORY",
        "--output-root", "ABSOLUTE_REPORT_DIRECTORY"
      ]
    }
  }
}
```

Then launch `claude --mcp-config calibration.mcp.json --strict-mcp-config` and check `/mcp`. The verified client is the Claude Code interactive terminal, tested against the server run from a checkout; this npm route and the plugin have passed the clean-install test suite but not yet a full session in Claude Code. Other MCP hosts are not claimed as verified. Node.js 20 or newer is required.

`--input-root` and `--output-root` are required and repeatable. Paths outside them are refused, reports go into new folders only, and existing files are never overwritten. `--help` and `--version` print and exit.

## Tools

`load_predictions`, `assess_predictions`, `fit_temperature`, `set_policy`, `review_test` and `create_report`. Test outcomes stay unopened until `review_test` receives an explicit decision through the client's elicitation form. Input formats, the complete workflow, disclosure rules and limits are documented in [docs/mcp.md](https://github.com/m-sanchez/calibration-explorer/blob/main/docs/mcp.md).

## What the package contains

`dist/cli.js` is a readable, unminified bundle of the server, the shared app modules and `@m-sanchez/calibrated` from the exact Git commit the app pins. The official MCP TypeScript SDK and zod are exact-pinned runtime dependencies. The UCI digits reference ships under `public/examples` with its CC BY 4.0 attribution. Reports record the same app source and numerical distribution hashes as a checkout of the same commit; `dist/NOTICE.txt` lists them with the bundled licence.

MIT licence. Copyright (c) 2026 Miguel Sánchez Durán.
