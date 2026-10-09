# Roadmap

What the project plans to do over the next year, until the end of 2027, and what it won't do. Plans move with what people use the card for: vote and propose in [Discussions](https://github.com/dortizesquivel/mmwave-3d-card/discussions).

## Planned

- **Real-hardware checks of the LD6004**: the axes, the sign of Z and the ceiling mode, against a real sensor.
- **Several sensors in one scene**: compare two sensors in the same room, or cover a large room with several.
- **Placing the sensor in a room model by clicking**: pick the spot on the model instead of typing coordinates.
- **Presets for LD2450-based sensors**: Everything Presence, Apollo MTR-1, Screek and similar, with their entity names.
- **A "probable pet" rule for the LD6004**: low targets outside the places where people lie down.
- **More sensors**: an LD6001 adapter, or others people ask for in Discussions.
- **Upkeep**: keep up with Home Assistant and three.js releases, keep the dependencies current, and keep the OpenSSF Best Practices badge and the Scorecard checks.

## Not planned

- **A cloud service, accounts or telemetry**: the card runs in the browser and sends nothing anywhere; that stays.
- **A backend integration** for Home Assistant, unless a feature can't work without one (for example, uploading room models from the card).
- **Platforms other than Home Assistant**.
- **Controlling devices** beyond what the sensors themselves expose (their zones and settings).
- **Identifying people**: the sensors track anonymous targets, and the card won't try to tell who someone is.

## Done

See the [changelog](CHANGELOG.md) and the [releases](https://github.com/dortizesquivel/mmwave-3d-card/releases).
