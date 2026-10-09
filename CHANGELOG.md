# Changelog

## v1.0.0 - 2026-10-09

- Landing page on GitHub Pages, with the live demo in the hero (#9) (45f6b8d)
- README: the hero GIF shows a room model next to the LD6004 (#7) (e4d8b12)
- Scorecard: read-only tokens, pinned actions, signed release assets, fuzzing and a fuller security policy (#8) (c07a8de)
- Security: CodeQL, OpenSSF Scorecard, npm audit, signed release provenance and SECURITY.md (#6) (3656785)
- Room models: a 3D model of the room, a futuristic style and zoom buttons (#5) (2786a8d)
- Test: replay finds quiet stretches on the LD2450 and the LD6004 too (#4) (78239bf)

## v0.7.0 - 2026-10-07

- Replay: skip quiet time, an activity strip and ×600 (#3) (515f662)

## v0.6.0 - 2026-10-07

- CI: unit and browser tests on every pull request; more tests (#2) (36b028b)
- Tilt for wall sensors that point down (e3b2aa2)

## v0.5.0 - 2026-10-07

- test: update screenshot baselines (09b3ffc)
- LD2410: the beam in 3D and animated detections; a gallery with each sensor (b755233)

## v0.4.0 - 2026-10-07

- Support the HLK-LD2410 as a distance-only sensor (bb0d889)
- README: requirements and installation first, with ESPHome setup and an Open in HACS button (16ab4f0)

## v0.3.0 - 2026-10-07

- test: update screenshot baselines (c8b9c81)
- Document the per-person heatmap and refresh its images (e618a59)
- Colour the heatmap by person and keep replay's layout still (d2773e9)
- Fix the README screenshot: the ceiling card was captured off screen (1679847)
- Document drawing zones and the LD6004 zone kinds (4bc7264)
- Draw new zones on the floor and edit every LD6004 zone kind (1e3ecff)
- test: target the editor panel's own summary (6294dfd)
- Add a usage guide with images and GIFs for each feature (7843595)
- Fix the fallback editor's checkboxes and show defaults in the editor (6d61104)

## v0.2.0 - 2026-10-06

- test: update screenshot baselines (f0eb6b8)
- Draw frames only while something moves (be2e1b0)
- Document the new features and refresh the README images (644719a)
- Add browser tests and screenshot comparisons in CI (d4c3085)
- Add room drawing, zone editing, tap for more-info, replay, heatmap and a visual editor (953f853)
- Bump the actions group with 2 updates (2947d52)

## v0.1.2 - 2026-10-06

- Require Home Assistant 2024.11, which added getGridOptions (cdf87aa)

## v0.1.1 - 2026-10-06

- Hatch interference zones and give them their own names (a59e32c)
- Add release workflow, changelog and Dependabot (e126eb9)

## v0.1.0 - 2026-10-06

- First release: three.js Lovelace card for HLK-LD2450 and HLK-LD6004 (3D, plan and sensor views, wall and ceiling mounting, zones, LD6004 height and posture, trails, HA theme, English and Spanish UI)
