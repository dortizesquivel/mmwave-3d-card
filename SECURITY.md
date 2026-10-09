# Security policy

## Reporting a vulnerability

Please report it privately through GitHub: **[report a vulnerability](https://github.com/dortizesquivel/mmwave-3d-card/security/advisories/new)** (the repository's Security tab → Report a vulnerability). Don't open a public issue for it. Include what you found, the version and how to reproduce it.

What to expect:

- An acknowledgement within 7 days.
- A first assessment within 14 days: whether it's confirmed and how serious it is.
- A fixed release as soon as possible, usually within 30 days for a confirmed vulnerability, published with a GitHub security advisory that credits you unless you'd rather not.
- Please keep it private until the fix is released, or for 90 days after your report, whichever comes first.

## Supported versions

Fixes go into the latest release. HACS offers it as an update.

## What the card can do

The card is a JavaScript module that runs in your browser, inside Home Assistant's frontend, with the permissions of the user viewing the dashboard.

- **Reads** the states of the entities it's configured for and, for replay and the heatmap, their history through Home Assistant's own connection (`history/history_during_period`).
- **Changes something** only when an admin user asks it to:
  - editing LD2450 zones: `number.set_value`;
  - editing LD6004 zones: the `esphome.<node>_set_*_zone` services;
  - switching the LD2410's engineering mode: `switch.turn_on` and `switch.turn_off`.
- **Downloads** the room model from the URL in `model.url`, if you set one. It makes no other network requests: no telemetry, no external servers and no CDN, because three.js is bundled in.
- **Doesn't run code it receives:** no `eval` or `Function` on data. Text from the config and from entity states is escaped before it goes into the page.

## How it's checked

The [assurance case](docs/ASSURANCE.md) explains in more detail why the card meets these requirements: the threat model, the trust boundaries, the design principles and the weaknesses it counters.

- **[CodeQL](.github/workflows/codeql.yml)**: static analysis of the source and of the workflows with GitHub's `security-extended` queries, on every pull request, on `main` and weekly.
- **[OpenSSF Scorecard](.github/workflows/scorecard.yml)**: the project's security practices, scored publicly.
- **[CI](.github/workflows/ci.yml)**: `npm audit` of what ships, unit and browser tests on every pull request. `main` only takes changes through pull requests that pass them.
- **Fuzzing**: [property-based tests](test/fuzz.test.js) with fast-check feed the sensor adapters, the LD6004 zone parser, the config and the model placement with random input, on every pull request.
- **Workflows**: every action is pinned to a commit, and tokens are read-only except in the jobs that publish.
- **Dependabot**: monthly updates of the npm packages and GitHub Actions.

## Verifying a release

Every release's `mmwave-3d-card.js` has a signed build-provenance attestation: proof that the file was built by the [release workflow](.github/workflows/release.yml) from the tagged source, not uploaded by hand. The release also carries it as `mmwave-3d-card.js.sigstore.json` (the Sigstore bundle) and `mmwave-3d-card.js.intoto.jsonl` (the signed in-toto statement). To check a downloaded copy, with the GitHub CLI:

```bash
gh attestation verify mmwave-3d-card.js --repo dortizesquivel/mmwave-3d-card
```

The build is also reproducible: checking out a release's tag and running `npm ci && npm run build` gives a `dist/mmwave-3d-card.js` byte for byte identical to the released file, so you can compare their SHA-256.
