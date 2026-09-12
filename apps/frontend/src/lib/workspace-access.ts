/** Presentation only. Server authentication and authorization remain authoritative. */
export const workspaceAccess = {
  canWrite: true,
  canManageAccount: true,
  label: 'Private workspace',
  ownerLabel: 'Your entity',
  allowsPath: (_pathname: string): boolean => true,
};
