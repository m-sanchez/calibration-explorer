# Local MCP integration check

Checked on 4 October 2026. Independent human participants: zero. These are protocol tests and agent-operated client checks using generated data and the public UCI digits reference.

## Automated protocol checks

The official TypeScript SDK 2.3.0 client launched the server through stdio. [Recorded results](mcp-evidence/sdk-verification.json) identify the observed reference metrics and generated artifact hashes. The client handlers supplied scripted accept and decline responses; this does not establish that a person saw a prompt.

The checks cover confidence-only and logit workflows, calibration/policy/exploration reports while test remains unopened, test-only CSV/JSON, declined disclosure, a client without elicitation, raw-row disclosure, zero accepted predictions, immutable loaded files, root escapes including symlinks, oversized and invalid files, duplicate output directories, parallel stale revisions, fit rejection and same-file inspection history. Malformed-file checks verify that quoted identifiers, unexpected keys and JSON syntax errors return no source fragments. Returned report hashes match the files; the HTML resource matches the saved HTML. The numerical reference remains unchanged: 1,797 test rows, T = 0.7259783904070843, accuracy 0.9488035614913745 before and after, NLL 0.17595188348336863 before and 0.15752642621016594 after.

## Actual interactive client

Claude Code interactive terminal **2.1.283** connected using the scoped local configuration. This was operated by the agent, without bypass-permission flags. The client was in its ordinary Auto mode.

- Loaded the public reference, fitted on calibration rows, assessed policy validation, and saved [before-test HTML](mcp-evidence/claude-before-test.html) and [JSON](mcp-evidence/claude-before-test.json). Both describe 574 policy-validation rows with `testViewed: false`.
- Set threshold 0.8 and locked the policy. `review_test` forced its explicit tool permission, then the client rendered the disclosure checkbox and Accept/Decline controls.
- Declined the first disclosure. The client summary retained `testViewed: false` and `changedAfterTest: false`.
- Retried, permitted the tool, checked the disclosure field and accepted. The client returned 1,797 test rows with the locked-before-test status and the reference measurements above.
- Saved [locked-test HTML](mcp-evidence/claude-locked-test.html) and [JSON](mcp-evidence/claude-locked-test.json), and read the matching HTML report resource through the actual client. Both HTML reports were opened in a browser through a loopback-only static viewer; the locked report displayed 1,797 rows and the recorded metrics and status.

The interactive client started before the version bump and retained `calibration-explorer/0.1.0` in its startup metadata. These files are the actual pre-release integration outputs, not rewritten 0.2.0 artifacts. Their source hash is `585de3167f7c76c1c438e4eb0e2c63356f9fbaac009dc4e5cb3091f14a545178`; the numerical distribution hash is `3331be184fa4cb43dd85f42d2dc67abffb03d47b1bbf574c466e80758d057dd2`. [Artifact hashes](mcp-evidence/claude-artifact-hashes.json) preserve their exact bytes.

## Scope

The subsequent [0.2.0 confidence-only check](release-0.2.0-audit.md) used the updated Claude Code 2.1.289 client and the merged release source. Its actual HTML/JSON files and hashes are recorded separately from the earlier 2.1.283 digits session.

The [cross-interface exposure matrix](../exposure-matrix.md) distinguishes shared-controller tests from actual MCP tools/resources and browser observations. Client acceptance establishes an observed integration on this machine, not external adoption, independent-user understanding, or assistive-technology accessibility. Inspection history remains limited to the current server process and cannot establish unseen test data elsewhere.
