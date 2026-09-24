# Public repository review

Reviewed September 23, 2026, before changing the repository's visibility, and repeated after the application and handbook changes were ready. This is a record of the checks performed, not a guarantee that every vulnerability or secret can be detected.

## Credential and history checks

- Fetched all current origin branches and tags. The starting revision was `2c2f3a5b64c5025bb907344dc3d36faff8813b2a`; 96 commits were reachable from local branches, remote references and tags.
- Downloaded Gitleaks **8.30.1** from its [official release](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1). The macOS ARM64 archive matched both GitHub's asset digest and the published checksum list: `b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5`.
- Scanned Git history with `gitleaks git --log-opts="--all --full-history" --redact=100 --ignore-gitleaks-allow`. Gitleaks reported 95 scanned commits and **zero findings**.
- Independently inspected all **566 unique reachable file blobs** (10.86 MB) for private-key headers, common provider-token formats, and credential-like file paths. **Zero findings**. This supplements the patch-based history scan.
- Scanned a separate snapshot of **122 tracked and nonignored working files**, including the changes available at that point, with Gitleaks directory scanning and archive decoding. **Zero findings**. Ignored local build output, account configuration, and dependencies were not copied into that publication snapshot.
- Repeated the all-reachable-history scan and scanned the final **142 tracked/nonignored working files** after the changes, including new tests, documentation, screenshots and workflow. **Zero findings** in both scans.
- Built and validated all **19 handbook guides plus the 404 page**, then scanned the exact `docs/site/dist` Pages payload: **27 files, 609,456 bytes**, with **zero findings**. The two included application screenshots were visually reviewed as synthetic test fixtures. The Pages workflow uploads only this generated directory.
- `npm audit` reported **zero vulnerabilities at every severity**, including the build/runtime development dependencies.

Reports were fully redacted and kept outside the repository. No credentials were printed in the report, uploaded, changed, or revoked. No history was rewritten. Public author names and commit email addresses are part of the repository history.

## Review of new application boundaries

Revision history and the manuscript check use the existing trusted, top-level IPC sender boundary. Chapter indexes and revision IDs are validated. Edits and restores use atomic book writes and refuse conflicting generation, narration, export, or delivery writes.

The comparison dialog inserts chapter content as plain text. The optional history HTML preview uses the existing prose sanitizer. Manuscript-check excerpts are also plain text. These features do not introduce an AI request or an additional network destination.

Background Claude Code and Codex authentication checks now use non-generating CLI status commands. Status failures remain unknown and never fall back to a completion. Raw account identifiers and API-key fragments from those commands are not returned to the renderer. Explicit model checks retain their disclosed test requests. Focused tests cover the exact command arguments, unknown/error handling, subscription environment scrubbing and output filtering.

Previous chapter text remains in the local, unencrypted book file until the history limit removes it or the book is deleted. It is deliberately excluded from ordinary book exports. Revisions should not be described as encrypted storage or a replacement for a backup.

## Publication follow-through

After publication, the first full CodeQL run on the updated `main` reported 26 findings. Review followed the actual data paths rather than treating the scanner's severity labels as proof of exploitation:

- The Grok authentication scan checked a path before reading it. It now inspects and reads one file descriptor, caps the read at 64 KiB even if the file grows, and closes the descriptor on every path. Regression tests replace the pathname and grow the file between inspection and reading.
- HTML artwork cleanup used incomplete regular-expression filters. Parser-based HTML, SVG and CSS allowlists replace that cleanup. JavaScript-disabled, network-isolated rasterization remains an additional boundary; adversarial markup and legitimate artwork are both tested.
- Two temporary-file findings originated from a test fixture passing the shared temporary-directory root. The fixture now owns an isolated temporary directory and verifies that text-only generation writes no artwork. Other test assertions and unused helpers were simplified.
- Four code-construction findings concern controlled offline UI fixtures encoded with `JSON.stringify` and passed directly to `webContents.executeJavaScript`. There is no HTML or script-element insertion at that boundary. These were dismissed as false positives with per-alert explanations.
- One network finding follows chapter prose into the documented, user-requested ElevenLabs narration body. The host is fixed to `api.elevenlabs.io`, the voice identifier is URL-encoded, and manuscript data does not control the destination. This was dismissed as a false positive with that explanation.

CodeQL remains enabled. Re-run it and the native packaging matrix for the final release commit; a reviewed false positive does not suppress future findings in other flows.

The final working-tree and Pages scans above are point-in-time checks. Repeat them if publication inputs change. Keep GitHub private vulnerability reporting enabled; after the repository became public, its API confirmed `enabled: true`.

The repository owner also enabled GitHub secret scanning, secret-scanning push protection, dependency vulnerability alerts and Dependabot security updates, and verified their enabled state through GitHub's APIs. These ongoing protections supplement the local review; they do not cover every possible credential format or vulnerability.

Complete the application and native-package test jobs before releasing installers. Use only tested release assets and retain the Mac signing/notarization gate. Successful source and credential reviews do not replace platform installation, signing or live-provider acceptance checks.

The review does not establish live access to every model, validate all third-party CLI configurations, or simulate every installed machine. Secret scanners can miss unknown formats, and dependency databases change over time. Ongoing CI and private vulnerability reporting remain necessary.
