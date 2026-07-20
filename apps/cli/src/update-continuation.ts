export type UpdateInvocation = {
  argv: string[];
  continuation: boolean;
};

export function normalizeUpdateInvocation(argv: string[], currentVersion: string): UpdateInvocation {
  const legacyContinuation = argv.length === 3
    && argv[0] === "update"
    && argv[1] === "--version"
    && argv[2] === currentVersion;

  return legacyContinuation
    ? { argv: ["update"], continuation: true }
    : { argv, continuation: false };
}
