const js = require('@eslint/js');
const globals = require('globals');

// Use the official TypeScript parser & plugin
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

const importPlugin = require('eslint-plugin-import');
const nodePlugin = require('eslint-plugin-node');
const promisePlugin = require('eslint-plugin-promise');

module.exports = [
  // 1) JS files (including eslint.config.js) — do NOT use typed TS parser here
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      // no `parser` here so the JS parser is used (avoids parserOptions.project issues)
      globals: {
        ...globals.node,
        ...globals.es2020,
      },
    },
    plugins: {
      import: importPlugin,
      node: nodePlugin,
      promise: promisePlugin,
    },
    settings: {
      'import/resolver': {
        node: {
          extensions: ['.js', '.ts'],
        },
      },
    },
  },

  // 2) TypeScript files — use typed parser with project
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      parser: tsParser,
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: __dirname,
      },
      globals: {
        ...globals.node,
        ...globals.es2020,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      import: importPlugin,
      node: nodePlugin,
      promise: promisePlugin,
    },
    settings: {
      'import/resolver': {
        node: {
          extensions: ['.js', '.ts'],
        },
        // <-- TypeScript resolver config: this is what's required to resolve TS paths & d.ts
        typescript: {
          project: ['./tsconfig.json'],
          alwaysTryTypes: true,
        },
      },
    },
  },

  // TypeScript-specific extra rules (applies to **/*.ts via the files above)
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      'no-unused-vars': 'off',
    },
  },

  // Test files
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/*.test.js', '**/*.spec.js'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },

  // Recommended JS rules
  js.configs.recommended,

  // Custom rules (applies globally; some rules are TS-aware via plugin availability above)
  {
    rules: {
      // General code quality
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-await-in-loop': 'error',
      'no-return-await': 'error',
      'require-await': 'error',
      'no-promise-executor-return': 'error',
      'no-template-curly-in-string': 'warn',

      // Import/Export rules
      'import/order': 'off',
      'import/no-unresolved': 'error',
      'import/named': 'error',
      'import/namespace': 'error',
      'import/default': 'error',
      'import/export': 'error',

      // Node.js specific rules
      'node/no-missing-import': 'off',
      'node/no-unsupported-features/es-syntax': 'off',
      'node/no-missing-require': 'off',
      'node/no-unpublished-import': [
        'error',
        {
          allowModules: ['express', 'compression', 'cors', 'helmet', 'express-rate-limit'],
        },
      ],

      // Promise handling
      'promise/always-return': 'error',
      'promise/no-return-wrap': 'error',
      'promise/param-names': 'error',
      'promise/catch-or-return': 'error',
    },
  },
];
