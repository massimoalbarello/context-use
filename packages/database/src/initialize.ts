export {};

await import("./migrate.ts");

const { runKnowledgeBootstrap } = await import("./bootstrap-knowledge.ts");
await runKnowledgeBootstrap();
