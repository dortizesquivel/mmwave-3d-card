# Contributing

Thanks for helping. Bug reports, ideas and pull requests are welcome.

## Reporting

- **Bugs**: open an [issue](https://github.com/dortizesquivel/mmwave-3d-card/issues/new/choose) with the bug form. It asks for the card's version, your sensor and the card's YAML. A screenshot or the browser console's errors help a lot.
- **Ideas**: propose them, or vote with a 👍 on the ones you want, in [Discussions → Ideas](https://github.com/dortizesquivel/mmwave-3d-card/discussions/categories/ideas). Questions go to [Q&A](https://github.com/dortizesquivel/mmwave-3d-card/discussions/categories/q-a).
- **Security problems**: don't open an issue; report them privately as [SECURITY.md](SECURITY.md) explains.

## Pull requests

`main` is protected: every change goes in through a pull request. A pull request is merged when:

- **The CI passes.** That covers `npm audit` of what ships, ESLint with no warnings, the unit tests with their coverage floor, the build, the browser tests (screenshots included), the HACS validation and CodeQL.
- **New functionality comes with tests.** A new option or behaviour gets unit tests (`test/*.test.js`) and, if it shows on screen or reacts to the user, a browser test (`test/browser/card.spec.js`). A bug fix gets a test that fails without it. Code that parses input from Home Assistant or the YAML should also be covered by the property-based tests in `test/fuzz.test.js`.
- **The docs follow the change.** The README describes every option in the configuration reference and every feature in "Using the card". If the change shows, update its images with `npm run docs:capture`.

## Style

- Match the code around you: plain ES modules, no framework, small functions, comments that say why rather than what.
- `npm run lint` must pass with no warnings (ESLint's recommended rules).
- User-visible text goes through `src/i18n.js`, in English and Spanish.
- Keep the card light: it runs on wall tablets. New dependencies need a good reason; three.js is the only runtime one.

## Running it

See [Development](README.md#development) in the README: `npm ci`, `npm test`, `npm run lint`, `npm run build`, `npm run demo` and the browser tests.

Contributions are released under the project's [MIT licence](LICENSE).
