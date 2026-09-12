import js from '@eslint/js';
import globals from 'globals';
export default [
  {
    ignores: ['node_modules/**', '.npm-cache/**', 'static/vendor/**', 'static/assets/**'],
  },
  {
    files: ['static/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['eslint.config.js', '*.mjs', 'tests/**/*.mjs', 'database/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
    },
  },
];
