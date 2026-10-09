// Linting for the card, the demo, the scripts and the tests: ESLint's recommended rules, warnings fail CI.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', '_site/', 'node_modules/', 'test-results/', 'playwright-report/'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, __VERSION__: 'readonly' },
    },
  },
  {
    files: ['scripts/**', 'test/**', 'build.mjs', 'playwright.config.js', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
