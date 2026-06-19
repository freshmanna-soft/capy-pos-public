/** @type {import('@cucumber/cucumber/api').IConfiguration} */
module.exports = {
  default: {
    // Step definitions are TypeScript, transpiled on the fly by tsx.
    requireModule: ['tsx/cjs'],
    require: ['tests/cucumber/step-definitions/**/*.ts'],
    paths: ['tests/cucumber/**/*.feature'],
    format: [
      'progress-bar',
      'html:cucumber-report.html',
      'json:cucumber-report.json',
    ],
    formatOptions: {
      snippetInterface: 'async-await',
    },
    parallel: 2,
    retry: 0,
    strict: true,
  },
};
