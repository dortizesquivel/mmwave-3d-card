# Security assurance case

Why we believe mmWave 3D Card meets its security requirements: what it must protect, where untrusted input comes in, which design principles it follows, which common weaknesses it counters and how that's checked. For reporting a vulnerability, see [SECURITY.md](../SECURITY.md).

## What it must protect

The card runs inside Home Assistant's frontend, with the permissions of whoever views the dashboard. The security requirements are:

1. **No code execution from data**: nothing from entity states, the YAML or a model file may run as code in the frontend, where the user's Home Assistant session lives.
2. **No unwanted changes**: the card may only change something (sensor zones, the LD2410's engineering mode) when an admin asks it to.
3. **No data leaving the house**: no telemetry and no requests to third parties; the only network requests are Home Assistant's own and the room model at the URL the admin configured.
4. **Robustness**: malformed or hostile input must not crash the dashboard or lock up the browser.
5. **Trustworthy releases**: what HACS installs must be the code in this repository, built by its CI.

## Threat model and trust boundaries

| Boundary | Input | Who controls it | Main threats |
|---|---|---|---|
| Entity states | Sensor readings, zone settings, text sensors (the LD6004's zone JSON) | The sensor's firmware, ESPHome, anyone who can set states | Malformed numbers, huge values, hostile JSON, text meant to inject markup |
| The card's YAML | Options, titles, zone names, the model URL | Dashboard admins | Invalid values, markup in names |
| The room model | A glTF/GLB file at `model.url` | Whoever controls that URL; normally the admin | Malformed or huge files |
| User actions | Clicks, drags, the zone editor | Anyone viewing the dashboard | Non-admins changing sensor zones |
| Build and release | Dependencies, GitHub Actions, the release file | Upstream projects, the CI | A compromised dependency or action; a tampered release file |

## Design principles applied

- **Least privilege**: the card has no permissions of its own beyond the viewer's; zone editing and engineering mode are offered only to admins, and Home Assistant enforces its own permissions on every service call. In CI, workflow tokens are read-only except in the jobs that publish.
- **Fail-safe defaults**: unreadable or out-of-range values become "not detected"; invalid YAML stops the card with a readable error rather than guessing.
- **Complete mediation**: every state goes through the adapters' readers (`readNumber`, `readLength`, `parseZones`) before reaching the scene; every option through `normalizeConfig`.
- **Economy of mechanism**: one runtime dependency (three.js), bundled; no framework, no backend, no dynamic code loading.
- **Open design**: everything is in this public repository; releases carry their build provenance.

## Common weaknesses countered

| Weakness | Countermeasure |
|---|---|
| Cross-site scripting (CWE-79) | Text from states and the YAML is escaped (`esc()`) before it goes into the page; labels are set as text, not markup. CodeQL checks for DOM XSS on every pull request. |
| Code injection (CWE-94, CWE-95) | No `eval`, `Function` or dynamic `import` of data; no HTML from data is executed. |
| Prototype pollution (CWE-1321) | No dynamic property paths from input; parsed JSON is only read field by field. |
| Improper input validation (CWE-20) | Validation of every option and state, with range checks: lengths past 1 km are rejected as corrupt, non-numeric zone values make a zone unreadable. |
| Uncontrolled resource consumption (CWE-400) | Drawing stops while the card is off screen or nothing moves; WebGL is released off screen; history is fetched once per period; model files are fetched once per URL. The README asks for models under 10 MB for wall tablets. |
| Use of components with known vulnerabilities (CWE-1395) | `npm audit` in CI, Dependabot alerts and security updates, monthly dependency updates. |
| Supply chain (CWE-829, CWE-494) | Locked dependencies (`npm ci`); GitHub Actions pinned to commits; releases built only by the release workflow and signed with a build-provenance attestation that users can verify. |

## Evidence

- **Static analysis**: CodeQL with the `security-extended` queries on the source and the workflows, on every pull request, on `main` and weekly; ESLint with no warnings tolerated.
- **Dynamic analysis**: property-based fuzzing with fast-check over the adapters, the LD6004 zone parser, config validation and model placement. It found and we fixed two crashes (a zone value that made `Number()` throw, and lengths that overflowed to Infinity), each with a regression test.
- **Tests**: unit tests with a coverage floor (85 % of lines and branches), and browser tests of the built card on every pull request.
- **Releases**: `gh attestation verify mmwave-3d-card.js --repo dortizesquivel/mmwave-3d-card` proves a release file came from the release workflow and a given commit.
- **Process**: protected `main` (pull requests only, required checks), private vulnerability reporting, and the OpenSSF Scorecard and Best Practices badge.
