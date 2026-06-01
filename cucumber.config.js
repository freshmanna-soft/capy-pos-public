module.exports = {
  default: {
    require: ['features/step-definitions/**/*.js'],
    format: [
      'progress-bar',
      'html:cucumber-report.html',
      'json:cucumber-report.json',
      '@cucumber/pretty-formatter'
    ],
    formatOptions: {
      snippetInterface: 'async-await'
    },
    parallel: 2,
    retry: 0,
    strict: true,
    dryRun: false,
    failFast: false,
    paths: ['features/**/*.feature'],
    publishQuiet: true
  }
};

// Made with Bob
