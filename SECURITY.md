# Security policy

## Reporting a vulnerability

Please report it privately: open the repository's **Security** tab and select **Report a vulnerability**. Don't open a public issue for it. Include what you found, the version and how to reproduce it. Give the maintainer reasonable time to fix it before you talk about it publicly.

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

- **[CodeQL](.github/workflows/codeql.yml)**: static analysis of the source and of the workflows with GitHub's `security-extended` queries, on every pull request, on `main` and weekly.
- **[OpenSSF Scorecard](.github/workflows/scorecard.yml)**: the project's security practices, scored publicly.
- **[CI](.github/workflows/ci.yml)**: `npm audit` of what ships, unit and browser tests on every pull request. `main` only takes changes through pull requests that pass them.
- **Dependabot**: monthly updates of the npm packages and GitHub Actions.

## Verifying a release

Every release's `mmwave-3d-card.js` has a signed build-provenance attestation: proof that the file was built by the [release workflow](.github/workflows/release.yml) from the tagged source, not uploaded by hand. To check a downloaded copy, with the GitHub CLI:

```bash
gh attestation verify mmwave-3d-card.js --repo dortizesquivel/mmwave-3d-card
```
