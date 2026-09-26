/**
 * Architectural boundaries, checked in CI with `pnpm deps:check`.
 * Module-level rules for apps/api (only import another module through its index.ts)
 * are added together with the first domain modules.
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make modules impossible to reason about or extract.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-cross-app-imports',
      severity: 'error',
      comment: 'Apps share code only through packages/*.',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/([^/]+)/', pathNot: '^apps/$1/' },
    },
    {
      name: 'api-module-public-api-only',
      severity: 'error',
      comment:
        'Outside an API module, import it only through its index.ts. Keeps modules replaceable and extractable.',
      from: { path: '^apps/api/src/', pathNot: '^apps/api/src/modules/' },
      to: {
        path: '^apps/api/src/modules/[^/]+/',
        pathNot: '^apps/api/src/modules/[^/]+/index[.]ts$',
      },
    },
    {
      name: 'api-modules-talk-through-index',
      severity: 'error',
      comment: "One module may not reach into another module's internals.",
      from: { path: '^apps/api/src/modules/([^/]+)/' },
      to: {
        path: '^apps/api/src/modules/[^/]+/',
        pathNot: ['^apps/api/src/modules/$1/', '^apps/api/src/modules/[^/]+/index[.]ts$'],
      },
    },
    {
      name: 'packages-must-not-import-apps',
      severity: 'error',
      comment: 'Packages are reusable building blocks and must never depend on an app.',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Unreferenced files are usually dead code.',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)[.][^/]+[.](?:js|cjs|mjs|ts|json)$',
          '[.]d[.]ts$',
          '(^|/)tsconfig[.]json$',
          '(^|/)(?:eslint|vitest|next|postcss|commitlint)[.]config[.](?:js|cjs|mjs|ts)$',
          '^apps/(portal|web)/src/app/',
        ],
      },
      to: {},
    },
    {
      name: 'not-to-dev-dependency',
      severity: 'error',
      comment: 'Production code must not import devDependencies.',
      from: {
        path: '^(apps|packages)/[^/]+/src/',
        pathNot: ['[.](test|spec)[.]tsx?$', '/src/testing/', '^apps/e2e/'],
      },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only', 'npm-peer'] },
    },
  ],
  options: {
    doNotFollow: { path: ['node_modules'] },
    exclude: { path: ['(^|/)(dist|[.]next|[.]turbo|coverage)/'] },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
