import type { ProxyConfiguration } from "nango";

type SavedBatch = {
  model: string;
  records: unknown[];
};

type RecordsLookup = {
  ids: string[];
  model: string;
};

export class FakeNango {
  metadata: unknown = undefined;
  readonly savedBatches: SavedBatch[] = [];
  readonly getCalls: ProxyConfiguration[] = [];
  readonly paginateCalls: ProxyConfiguration[] = [];
  readonly yieldedPages = new Map<string, number>();
  readonly recordsLookups: RecordsLookup[] = [];
  readonly logs: string[] = [];
  checkpoint: unknown = undefined;
  readonly postCalls: ProxyConfiguration[] = [];

  private readonly responses = new Map<string, unknown>();
  private readonly pages = new Map<string, unknown[][]>();
  private readonly failures = new Map<string, Error>();
  private readonly records = new Map<string, Map<string, unknown>>();

  setResponse(endpoint: string, response: unknown): void {
    this.responses.set(endpoint, response);
  }

  setPages(endpoint: string, pages: unknown[][], state?: "open" | "closed"): void {
    this.pages.set(routeKey(endpoint, state), pages);
  }

  fail(endpoint: string, error: Error, state?: "open" | "closed"): void {
    this.failures.set(routeKey(endpoint, state), error);
  }

  setRecord(model: string, id: string, record: unknown): void {
    let modelRecords = this.records.get(model);
    if (!modelRecords) {
      modelRecords = new Map();
      this.records.set(model, modelRecords);
    }
    modelRecords.set(id, structuredClone(record));
  }

  getMetadata(): Promise<unknown> {
    return Promise.resolve(structuredClone(this.metadata));
  }

  getCheckpoint(): Promise<unknown> {
    return Promise.resolve(structuredClone(this.checkpoint));
  }

  saveCheckpoint(checkpoint: unknown): Promise<void> {
    this.checkpoint = structuredClone(checkpoint);
    return Promise.resolve();
  }

  async post(config: ProxyConfiguration): Promise<{ data: unknown }> {
    this.postCalls.push(structuredClone(config));
    const method = typeof config.data === "object" && config.data !== null && "method" in config.data
      ? String(config.data.method)
      : "";
    const params = typeof config.data === "object" && config.data !== null && "params" in config.data
      ? config.data.params as { name?: string }
      : undefined;
    const key = params?.name ? `${config.endpoint}:${method}:${params.name}` : `${config.endpoint}:${method}`;
    if (!this.responses.has(key)) throw new Error(`Fake Nango has no POST response for ${key}`);
    return { data: structuredClone(this.responses.get(key)) };
  }

  async get(config: ProxyConfiguration): Promise<{ data: unknown }> {
    this.getCalls.push(structuredClone(config));
    const failure = this.failures.get(config.endpoint);
    if (failure) throw failure;
    if (!this.responses.has(config.endpoint)) {
      throw new Error(`Fake Nango has no GET response for ${config.endpoint}`);
    }
    return { data: structuredClone(this.responses.get(config.endpoint)) };
  }

  async *paginate(config: ProxyConfiguration): AsyncGenerator<unknown[]> {
    this.paginateCalls.push(structuredClone(config));
    const state = typeof config.params === "object" && config.params !== null
      ? config.params["state"]
      : undefined;
    const key = routeKey(
      config.endpoint,
      state === "open" || state === "closed" ? state : undefined,
    );
    const failure = this.failures.get(key);
    if (failure) throw failure;
    const configuredPages = this.pages.get(key);
    if (!configuredPages) {
      throw new Error(`Fake Nango has no paginated response for ${key}`);
    }

    for (const page of configuredPages) {
      this.yieldedPages.set(key, (this.yieldedPages.get(key) ?? 0) + 1);
      yield structuredClone(page);
    }
  }

  getRecordsByIds(ids: string[], model: string): Promise<Map<string, unknown>> {
    this.recordsLookups.push({ ids: [...ids], model });
    const result = new Map<string, unknown>();
    const modelRecords = this.records.get(model);
    for (const id of ids) {
      const record = modelRecords?.get(id);
      if (record !== undefined) result.set(id, structuredClone(record));
    }
    return Promise.resolve(result);
  }

  batchSave(records: unknown[], model: string): Promise<boolean> {
    const copied = structuredClone(records);
    this.savedBatches.push({ model, records: copied });
    for (const record of copied) {
      if (
        typeof record === "object"
        && record !== null
        && "id" in record
        && typeof record.id === "string"
      ) {
        this.setRecord(model, record.id, record);
      }
    }
    return Promise.resolve(true);
  }

  log(message: string): Promise<void> {
    this.logs.push(message);
    return Promise.resolve();
  }
}

function routeKey(endpoint: string, state?: "open" | "closed"): string {
  return state ? `${endpoint}?state=${state}` : endpoint;
}
