export type MigrationDescriptor = {
  version: string;
  checksum: string;
};

export type AppliedMigration = {
  version: string;
  checksum: string | null;
};

export function assertMigrationState(
  files: MigrationDescriptor[],
  applied: AppliedMigration[],
  existingRelations: string[],
  baseline = "001_baseline.sql",
): void {
  const current = new Map(files.map((file) => [file.version, file.checksum]));
  const unknown = applied.filter(({ version }) => !current.has(version)).map(({ version }) => version);
  if (unknown.length) {
    throw new Error(
      `Database contains migrations that are not part of this schema: ${unknown.join(", ")}. `
      + "This release requires a fresh database.",
    );
  }

  const baselineApplied = applied.some(({ version }) => version === baseline);
  if (current.has(baseline) && !baselineApplied && (applied.length || existingRelations.length)) {
    const reason = applied.length
      ? `legacy migrations: ${applied.map(({ version }) => version).join(", ")}`
      : `existing relations: ${existingRelations.join(", ")}`;
    throw new Error(`${baseline} can only be applied to a fresh database; found ${reason}`);
  }

  for (const migration of applied) {
    const expected = current.get(migration.version)!;
    if (!migration.checksum) {
      throw new Error(
        `Database migration ${migration.version} has no recorded checksum. `
        + "This release requires a fresh database.",
      );
    }
    if (migration.checksum !== expected) {
      throw new Error(
        `Database migration ${migration.version} does not match this release. `
        + "This release requires a fresh database.",
      );
    }
  }
}
