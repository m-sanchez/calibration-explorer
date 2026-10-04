# Local calibration MCP

The local server reads selected prediction files and writes assessment reports into your project. It uses the same parser, numerical library, workflow guards, interpretation and report generator as the browser. There is no training, model inference, telemetry or remote service in this server.

The first client target is **Claude Code interactive terminal 2.1.283**, using stdio and form elicitation. The server pins the official TypeScript server and test-client SDKs to **2.3.0**. Other hosts are not claimed as verified. The public Hugging Face Space remains a separate, standalone browser application.

## Install and launch

Use Node 24.9 or newer, Git, and the existing repository checkout:

```text
npm ci
node scripts/mcp-config.ts --input-root public/examples --output-root review/mcp-client-validation --output .cache/calibration.mcp.json
claude --mcp-config .cache/calibration.mcp.json --strict-mcp-config
```

The configuration generator writes the exact current Node executable and absolute paths. It creates the selected output directory and refuses to replace an existing configuration. For your own experiment, select its prediction directory as the input root and its report directory as the output root. The server accepts repeated `--input-root` and `--output-root` arguments if you configure more than one directory manually. It does not discover or read other projects.

The resulting configuration has this structure, with real paths filled in by the command:

```json
{
  "mcpServers": {
    "calibration": {
      "type": "stdio",
      "command": "ABSOLUTE_NODE_EXECUTABLE",
      "args": [
        "ABSOLUTE_CHECKOUT/mcp/cli.ts",
        "--input-root", "ABSOLUTE_PREDICTION_DIRECTORY",
        "--output-root", "ABSOLUTE_REPORT_DIRECTORY"
      ]
    }
  }
}
```

This session-scoped launch does not edit your global client configuration. Check `/mcp` for the calibration server. Use the client's ordinary approval mode, not bypass flags or an elicitation hook that answers on your behalf.

## One complete workflow

Start with this request, replacing the output path with the configured directory:

> Use the calibration MCP to load the bundled digits reference. Fit temperature on calibration rows, then assess policy_validation. Save an aggregate report named before-test in my configured report directory. Keep test results unopened. Evaluate threshold 0.8 on policy validation and lock it. Ask through the tool before showing test outcomes. Once I accept, save a report named locked-test and return its HTML path.

For your data, replace the reference with an explicit absolute CSV/JSON path. [Two Python recipes](prediction-recipes.md) prepare the existing canonical formats.

| Tool | Behaviour |
| --- | --- |
| `load_predictions` | Reads a selected path or the bundled reference. Returns a run ID, fingerprint, counts and policy metadata, without outcomes. |
| `assess_predictions` | Measures an explicit calibration, policy-validation or exploration split. Returns bounded aggregates and interpretation. |
| `fit_temperature` | Uses calibration logits only. Records fit failure, search-boundary and constant-objective outcomes. Invalidates a prior lock. |
| `set_policy` | Evaluates an explicit threshold on full policy validation and optionally locks it. It does not optimise the threshold. |
| `review_test` | Requires the client's explicit review decision before the first exposure. A test-only file remains unopened until this action. |
| `create_report` | Writes HTML and JSON into a new named output folder. Optional selected-split CSV and all-source JSON require separate disclosure. |

Mutation tools take the latest run `revision`. Conflicting calls are serialised, and stale revisions are rejected. Read `calibration://runs/<run-id>` to recover the current metadata and last permitted assessment. Reopening the same byte-identical file does not erase inspection within the running server.

## Test review and reports

`review_test` declares Claude Code's `anthropic/requiresUserInteraction` metadata. The client presents its explicit tool permission even when ordinary tool calls are automatically permitted. The server then requests a form with an unchecked confirmation field. Declining, cancelling, leaving the checkbox empty, or using a client without elicitation reveals no new test results. These are client-mediated controls; a server cannot prove that an arbitrary third-party client showed a question to a person.

Calibration, policy-validation and confidence-only reports do **not** require test review. Aggregate preview and report generation do not expose unopened test outcomes. Explicit all-source JSON includes every partition and supplied provenance, so it records test inspection. Selected-split CSV includes row identifiers and outcomes for that selection; exporting a non-test selection does not inspect the test split.

`create_report` returns each saved file's absolute path, byte count and SHA-256, plus a `calibration://reports/<id>` resource for the matching HTML snapshot. Ask the client to open the returned HTML path, or open it from your file manager. The tool does not launch another application automatically. HTML is script-free, includes charts and limitations, and makes no remote requests. Report resources above 256 KiB return a local-opening instruction instead of flooding the conversation. Raw JSON/CSV files are not exposed as automatically readable resources.

Default JSON is an assessment record, not a self-contained reproduction package. Reproduction requires the matching input file and recorded software unless source observations are explicitly included. Existing [Python replay instructions](usability/reproduction.md) remain applicable.

## Data and lifetime

Raw files remain in the local process by default. Returned summaries, metadata, selected group names and requested report resources can enter your MCP client's model context and reach its provider. Do not describe this as nothing leaving your computer. Aggregate data can still reveal information about small groups.

The server enforces resolved input/output roots, existing input limits, 16 loaded runs per process, and new-folder-only report writes. Input limits remain 5 MiB, 20,000 rows, 100 classes and 1,000,000 logits. These are caps, not a performance guarantee. Inputs are immutable snapshots; editing a file on disk does not alter a loaded run.

Inspection history is process-local. Stopping or restarting the server clears its loaded runs and history. Neither a lock nor a fresh server establishes that test data was unseen elsewhere or statistically independent. Reports state this scope. Changing a policy after test review remains exploratory even after relocking.

MCP evidence records the server/core source hash and numerical distribution hash explicitly. The core hash covers sorted `src`, `mcp`, `package.json` and `package-lock.json` paths; hashes use relative paths with forward slashes, NUL, bytes, NUL. The numerical hash covers the installed library's `dist` tree with the same encoding as the browser build.

## Verification

```text
node --test tests/mcp.test.ts tests/exposure-matrix.test.ts tests/workflow.test.ts
```

The stdio check starts a real SDK client and server subprocess, tests accepted and declined disclosure responses, verifies confidence/logit workflows and file contents, and writes `.cache/mcp-verification.json`. Those answers are scripted protocol checks, not human usability evidence. [The exposure matrix](exposure-matrix.md) identifies the shared-controller checks and actual tool/resource checks separately. Independent human participants remain zero.

The [actual-client integration record](usability/mcp-audit.md) separately documents an agent-operated Claude Code 2.1.283 terminal session, its rendered disclosure controls, and saved reports.

Official references: [SDK v2](https://github.com/modelcontextprotocol/typescript-sdk), [input-required elicitation and legacy compatibility](https://ts.sdk.modelcontextprotocol.io/v2/servers/input-required.html), [Claude Code elicitation and per-tool user interaction](https://code.claude.com/docs/en/mcp#respond-to-mcp-elicitation-requests).
