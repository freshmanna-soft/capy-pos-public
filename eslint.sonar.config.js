// @ts-check
/**
 * ESLint configuration for SonarJS quality gate (pre-commit hook).
 * Elevates critical sonarjs rules to errors to block commits.
 */
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');
const sonarjs = require('eslint-plugin-sonarjs');

module.exports = defineConfig([
  {
    ignores: ['src/stories/**', 'coverage/**', 'dist/**', 'node_modules/**'],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    plugins: {
      sonarjs,
    },
    processor: angular.processInlineTemplates,
    rules: {
      // Sonar rules elevated to ERROR for quality gate
      'sonarjs/cognitive-complexity': ['error', 15],
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-collapsible-if': 'error',
      'sonarjs/prefer-immediate-return': 'warn',
      'sonarjs/no-redundant-jump': 'error',
      'sonarjs/no-small-switch': 'warn',
      'sonarjs/no-nested-template-literals': 'warn',
      // Intentionally OFF — too noisy for pre-commit (mostly test files)
      'sonarjs/no-duplicate-string': 'off',
      // Suppress non-sonar rules to focus on sonar gate only
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@angular-eslint/directive-selector': 'off',
      '@angular-eslint/component-selector': 'off',
    },
  },
]);
