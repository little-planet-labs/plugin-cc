import {config} from '@remotion/eslint-config-flat';

export default [
  ...config,
  {
    ignores: ['out/**', 'node_modules/**', '.venv/**', '.venv-align/**', '.cache/**'],
  },
  {
    // Node scripts (pnpm analyze / align / render / preview / contact-sheet).
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {process: 'readonly', console: 'readonly'},
    },
  },
];
