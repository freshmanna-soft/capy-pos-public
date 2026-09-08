import type { StorybookConfig } from '@storybook/angular';

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-docs', '@storybook/addon-onboarding'],
  framework: '@storybook/angular',
  // Disabled 2026-09-08: CI runners are ephemeral, so persistent cross-run
  // webpack caching has no benefit there anyway — see the matching note on
  // the "Build Storybook" CI step (ci.yml) for the full story of why this
  // was investigated (a `Cache.shutdown`-related false-failure exit code).
  webpackFinal: async (webpackConfig) => {
    webpackConfig.cache = false;
    return webpackConfig;
  },
};
export default config;
