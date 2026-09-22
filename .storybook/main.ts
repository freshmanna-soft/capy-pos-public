import type { StorybookConfig } from '@storybook/angular';

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-docs', '@storybook/addon-onboarding'],
  framework: '@storybook/angular',
  // Disabled 2026-09-08: `build-storybook` was throwing a generic "Broken
  // build" error (exit 127) from webpack's Compiler.close/Cache.shutdown
  // step, EVEN THOUGH the actual compilation succeeded and produced a
  // complete, valid storybook-static/ output (confirmed by inspecting the
  // output directly, and by patching the builder to print the real wrapped
  // error: SB_BUILDER-WEBPACK5_0003, thrown from webpack's own cache-persist
  // step, not from any real compile error — clearing node_modules/.cache
  // didn't fix it either). CI runners are ephemeral anyway, so persistent
  // cross-run caching has no benefit there; disabling it sidesteps whatever
  // is failing during cache serialization without needing to root-cause it
  // further.
  webpackFinal: async (webpackConfig) => {
    webpackConfig.cache = false;
    return webpackConfig;
  },
};
export default config;
