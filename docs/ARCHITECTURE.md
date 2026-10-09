# Architecture

mmWave 3D Card is a single JavaScript module that Home Assistant's frontend loads as a dashboard resource. It has no backend: everything runs in the browser of whoever views the dashboard, through the connection Home Assistant's frontend already has.

```
 ESPHome sensor ──► Home Assistant ──► frontend (hass object) ──► the card
   (LD2450,          (entities,          pushes every state          │
    LD6004,           recorder)          change to the card          ▼
    LD2410)                                              adapters → frame → three.js scene
                     ◄── services (zone edits, by admins) ◄──────────┘
                     ◄── history/history_during_period (replay, heatmap)
```

## Components

| File | Role |
|---|---|
| `src/mmwave-3d-card.js` | The custom element: Home Assistant lifecycle (`setConfig`, `hass`), the modes (live, replay, heatmap), the table, zone editing and the buttons. Releases the WebGL context when off screen. |
| `src/config.js` | Validates the YAML and fills in defaults; throws readable errors that Home Assistant shows as an error card. |
| `src/model.js` | Validates `model:` and computes where a room model goes so the sensor sits on the radar. |
| `src/adapters/` | One adapter per sensor (`ld2450.js`, `ld6004.js`, `ld2410.js`) maps its entities to a common frame in metres: targets, zones, ranges. `common.js` reads states with units and bounds. Adapters also write zones back through Home Assistant services. |
| `src/scene.js` | The three.js scene: coverage, room, room model, zones and their editing, people and trails, the LD2410's beam, the heatmap layer, picking, views and zoom. Draws only while something changes. |
| `src/history.js`, `src/heatmap.js` | Replay and heatmap: reads the recorder's history and computes time spent per floor cell. |
| `src/editor.js` | The visual editor, built on Home Assistant's `ha-form`. |
| `src/i18n.js`, `src/theme.js` | Texts in English and Spanish; colours from the Home Assistant theme. |

`build.mjs` bundles `src/` and three.js with esbuild into `dist/mmwave-3d-card.js`, the one file HACS installs.

## Data flow

1. Home Assistant sets the card's `hass` property on every state change.
2. The card checks whether any of its entities changed, then asks its adapter for a **frame**: present targets with x/y (and z on the LD6004), zones as boxes, or distances and gate energies on the LD2410. Every value is parsed and range-checked; anything unreadable becomes "not detected".
3. The scene receives the frame and moves people and zones towards it; the table and chips show the same frame.
4. In replay and heatmap modes, the card fetches history once with `history/history_during_period` and builds frames for past moments from it.
5. When an admin edits a zone, the adapter converts it back to the sensor's units and calls the sensor's Home Assistant services; the frame then shows what the sensor reports back.

## Trust boundaries

What crosses from outside the card, and how it's handled, is in the [assurance case](ASSURANCE.md): entity states, the card's YAML, the room model file, the user's actions, and the build and release chain.

## Tests

`test/*.test.js` (node:test) covers the adapters, config, model placement, history, heatmap, editor and texts; `test/fuzz.test.js` feeds them random input with fast-check; `test/browser/card.spec.js` (Playwright) runs the built card in the demo, a simulated Home Assistant. The CI runs all of them, ESLint and CodeQL on every pull request.
