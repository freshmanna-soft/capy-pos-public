/** @type {import('@cucumber/cucumber/api').IConfiguration} */
module.exports = {
  default: {
    require: ['tests/cucumber/step-definitions/**/*.js'],
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
