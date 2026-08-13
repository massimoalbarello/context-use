import type { GeneratedObjectMetadata } from "./storage.ts";

export class KnowledgeExportPreparationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "KnowledgeExportPreparationError";
  }
}

export type KnowledgeExportPreparationFailure = {
  message: string;
  httpStatus: number;
  code: string;
};

export type KnowledgeExportPreparationState =
  | { status: "idle" }
  | { status: "processing" }
  | ({ status: "failed" } & KnowledgeExportPreparationFailure);

function preparationFailure(error: unknown): KnowledgeExportPreparationFailure {
  if (error instanceof KnowledgeExportPreparationError) {
    return { message: error.message, httpStatus: error.status, code: error.code };
  }
  return {
    message: "The knowledge archive could not be prepared. Try preparing it again.",
    httpStatus: 500,
    code: "export_preparation_failed",
  };
}

export class KnowledgeExportPreparationQueue {
  private readonly builds = new Map<string, Promise<GeneratedObjectMetadata>>();
  private readonly failures = new Map<string, KnowledgeExportPreparationFailure>();

  constructor(
    private readonly onUnexpectedError: (intentId: string, error: unknown) => void = () => undefined,
  ) {}

  start(
    intentId: string,
    build: () => Promise<GeneratedObjectMetadata>,
    retry = false,
  ): void {
    if (this.builds.has(intentId)) return;
    if (this.failures.has(intentId) && !retry) return;
    this.failures.delete(intentId);

    const pending = build();
    this.builds.set(intentId, pending);
    void pending.then(() => {
      this.failures.delete(intentId);
    }).catch((error: unknown) => {
      this.failures.set(intentId, preparationFailure(error));
      if (!(error instanceof KnowledgeExportPreparationError)) {
        this.onUnexpectedError(intentId, error);
      }
    }).finally(() => {
      if (this.builds.get(intentId) === pending) this.builds.delete(intentId);
    });
  }

  state(intentId: string): KnowledgeExportPreparationState {
    const failure = this.failures.get(intentId);
    if (failure) return { status: "failed", ...failure };
    if (this.builds.has(intentId)) return { status: "processing" };
    return { status: "idle" };
  }

  forget(intentId: string): void {
    this.failures.delete(intentId);
  }
}
