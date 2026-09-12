import type { workspaceAccess as PersonalWorkspaceAccess } from '../src/lib/workspace-access';

export const workspaceAccess: typeof PersonalWorkspaceAccess = {
  canWrite: false,
  canManageAccount: false,
  label: 'Public demo · Read only',
  ownerLabel: 'Steve’s context · 2001–2007',
  allowsPath: (path) =>
    path === '/' ||
    path === '/hypermedia' ||
    /^\/(?:entities|pages|assets|records)(?:\/(?!new$)[a-z0-9][a-z0-9-]*)?$/.test(path),
};
