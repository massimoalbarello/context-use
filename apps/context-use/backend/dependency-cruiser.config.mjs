const backend = '^apps/context-use/backend/src/';

export default {
  forbidden: [
    {
      name: 'resolve-backend-imports',
      severity: 'error',
      comment: 'Fix the internal import so architecture checks can resolve its owner.',
      from: { path: backend },
      to: { path: '^(#backend/|\\.)', couldNotResolve: true },
    },
    {
      name: 'inner-layers-stay-independent',
      severity: 'error',
      comment: 'Models and technical support must not depend on persistence or application layers.',
      from: { path: `${backend}(models|lib)/` },
      to: { path: `${backend}(db|repositories|routes|services)/` },
    },
    {
      name: 'database-stays-independent',
      severity: 'error',
      comment: 'Database infrastructure must not depend on repositories, services, or routes.',
      from: { path: `${backend}db/` },
      to: { path: `${backend}(repositories|routes|services)/` },
    },
    {
      name: 'repositories-receive-infrastructure',
      severity: 'error',
      comment: 'Repositories receive their database and must not depend on services or routes.',
      from: { path: `${backend}repositories/` },
      to: { path: `${backend}(db|routes|services)/` },
    },
    {
      name: 'repository-capabilities-stay-independent',
      severity: 'error',
      comment:
        'Services coordinate repository capabilities. Keep persistence helpers with their owner.',
      from: { path: `${backend}repositories/([^/]+)/` },
      to: {
        path: `${backend}repositories/[^/]+/`,
        pathNot: [
          `${backend}repositories/$1/`,
          // Entity mutations retire stale face references within the same transaction.
          `${backend}repositories/faces/portrait-links\\.ts$`,
        ],
      },
    },
    {
      name: 'portrait-cleanup-stays-with-its-transaction',
      severity: 'error',
      comment: 'Only face persistence and the entity transaction share portrait cleanup.',
      from: {
        path: `${backend}repositories/`,
        pathNot: `${backend}repositories/(faces/|entities/repository\\.ts$)`,
      },
      to: { path: `${backend}repositories/faces/portrait-links\\.ts$` },
    },
    {
      name: 'services-use-repository-contracts',
      severity: 'error',
      comment: 'Import repository contracts with import type; main.ts supplies the implementation.',
      from: { path: `${backend}services/` },
      to: { path: `${backend}repositories/`, dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'services-stay-transport-independent',
      severity: 'error',
      comment: 'Services depend on repository contracts, never database bootstrap or routes.',
      from: { path: `${backend}services/` },
      to: { path: `${backend}(db|routes)/` },
    },
    {
      name: 'service-capabilities-stay-independent',
      severity: 'error',
      comment:
        'Depend on the required repository contracts instead of coordinating another service.',
      from: { path: `${backend}services/([^/]+)/` },
      to: { path: `${backend}services/`, pathNot: `${backend}services/$1/` },
    },
    {
      name: 'controllers-use-services',
      severity: 'error',
      comment:
        'Controllers and the application factory receive services, never persistence modules.',
      from: { path: `${backend}(routes/|app\\.ts$)` },
      to: { path: `${backend}(db|repositories)/` },
    },
    {
      name: 'route-schemas-stay-independent',
      severity: 'error',
      comment: 'Route schemas describe transport contracts without depending on services.',
      from: { path: `${backend}routes/.*/model\\.ts$` },
      to: { path: `${backend}services/` },
    },
    {
      name: 'public-app-type-comes-from-app',
      severity: 'error',
      comment: 'Derive the public application type from app.ts, not implementation layers.',
      from: { path: `${backend}types\\.ts$` },
      to: { path: `${backend}(db|repositories|routes|services)/` },
    },
    {
      name: 'main-owns-production-infrastructure',
      severity: 'error',
      comment: 'Only main.ts selects production configuration and creates infrastructure clients.',
      from: { path: backend, pathNot: `${backend}main\\.ts$` },
      to: { path: `${backend}(db/client|lib/env|lib/storage/client)\\.ts$` },
    },
    {
      name: 'graph-repository-is-private',
      severity: 'error',
      comment: 'Graph queries must enter through HypermediaGraphService.',
      from: {
        path: backend,
        pathNot: `${backend}(main\\.ts$|services/hypermedia-graph/|repositories/hypermedia-graph/)`,
      },
      to: { path: `${backend}repositories/hypermedia-graph/` },
    },
    {
      name: 'retrieval-service-owns-search',
      severity: 'error',
      comment: 'Search must enter through HypermediaRetrievalService.',
      from: { path: `${backend}services/`, pathNot: `${backend}services/hypermedia-retrieval/` },
      to: { path: `${backend}repositories/hypermedia-retrieval/` },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      conditionNames: ['import', 'node', 'default'],
      exportsFields: ['exports'],
    },
  },
};
