/**
 * Commitlint configuration for Capy-POS
 * Enforces Conventional Commits format: https://www.conventionalcommits.org/
 *
 * Format: <type>(<scope>): <subject>
 *
 * Types:
 *   feat     - A new feature
 *   fix      - A bug fix
 *   docs     - Documentation only changes
 *   style    - Changes that do not affect the meaning of the code (formatting)
 *   refactor - A code change that neither fixes a bug nor adds a feature
 *   perf     - A code change that improves performance
 *   test     - Adding missing tests or correcting existing tests
 *   build    - Changes that affect the build system or external dependencies
 *   ci       - Changes to CI configuration files and scripts
 *   chore    - Other changes that don't modify src or test files
 *   revert   - Reverts a previous commit
 *
 * Scopes (optional, domain-specific):
 *   pos, inventory, customers, reports, dashboard, settings, history
 *   auth, payments, agents, navigation, search, cart
 *   e2e, unit, infra, db, ui
 *
 * Examples:
 *   feat(pos): add product search with debounce
 *   fix(search): prevent results from clearing on selection
 *   test(e2e): add persona-based navigation accessibility tests
 *   docs: update PROJECT_STATUS with sprint 3 completion
 *   refactor(cart): extract total calculation to domain service
 *   chore: add commitlint and conventional commits enforcement
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Type must be one of the allowed values
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'style',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'chore',
        'revert',
      ],
    ],
    // Type is required and must be lowercase
    'type-case': [2, 'always', 'lower-case'],
    'type-empty': [2, 'never'],
    // Subject is required
    'subject-empty': [2, 'never'],
    // Subject must not end with a period
    'subject-full-stop': [2, 'never', '.'],
    // Subject max length 100 chars
    'subject-max-length': [2, 'always', 100],
    // Header (full first line) max 120 chars
    'header-max-length': [2, 'always', 120],
    // Body lines max 200 chars (allow longer for URLs, etc.)
    'body-max-line-length': [1, 'always', 200],
    // Scope is optional but must be lowercase if provided
    'scope-case': [2, 'always', 'lower-case'],
  },
};
