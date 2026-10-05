# Calibration Explorer plugin

This Claude Code plugin adds Calibration Explorer's local MCP server to the current project. It checks whether a classifier's saved confidence matches how often it was correct, fits one temperature on calibration rows, evaluates and locks a threshold on policy-validation rows, and writes HTML and JSON reports. It does not train or run a classifier.

## Install

```text
/plugin marketplace add m-sanchez/calibration-explorer
/plugin install calibration-explorer@calibration-explorer
```

Check `/mcp` for the `calibration` server, then ask Claude to load a prediction file from your project. The workflow, input formats and disclosure rules are in [docs/mcp.md](https://github.com/m-sanchez/calibration-explorer/blob/main/docs/mcp.md).

## What it runs, reads, writes and sends

- **Runs:** `npx -y @m-sanchez/calibration-explorer-mcp@0.2.0 --input-root <project> --output-root <project>`, an exact-pinned npm package. On first use npx downloads it and its two runtime dependencies, the official MCP TypeScript SDK and zod, from the npm registry.
- **Reads:** only prediction files you ask it to load from inside the directory Claude Code was started in, plus the UCI digits reference bundled in the package. Paths outside it are refused, so start Claude Code in the project, not in your home directory.
- **Writes:** report files into a new folder you name inside the project. Existing files are never overwritten.
- **Sends:** nothing to any remote service. The server has no telemetry or network calls. Tool results, such as aggregate metrics, row counts and report paths, enter Claude's context and so reach the model provider. Test outcomes stay unopened until you accept a disclosure form.

The verified client is the Claude Code interactive terminal, tested against the server run from a checkout; the full workflow through this plugin has not yet been exercised end to end. Node.js 20 or newer must be on `PATH`. Source, tests and the bundled code are at [github.com/m-sanchez/calibration-explorer](https://github.com/m-sanchez/calibration-explorer). MIT licence.
