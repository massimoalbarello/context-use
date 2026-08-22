import { runTemplateCommand } from "@context-use/database";
import { BrokeredMarkdownObjectStore } from "./markdown-object-store.ts";
import { BrokeredStorage } from "./storage-client.ts";

const action = process.argv[2];
if (action !== "plan" && action !== "apply") {
  throw new Error("Expected template action: plan or apply");
}
const templateName = process.argv[3] ?? "default";
const extraArguments = process.argv.slice(4);
const knownArguments = new Set(["--force-template"]);
if (extraArguments.some((argument) => !knownArguments.has(argument))) {
  throw new Error("Unknown template command option");
}

const development = process.env.NODE_ENV !== "production";
const socketPath = process.env.STORAGE_SOCKET_PATH
  ?? (development ? "/tmp/context-use-storage.sock" : undefined);
const token = process.env.STORAGE_DASHBOARD_TOKEN
  ?? (development ? "development-storage-dashboard-token" : undefined);
if (!socketPath || !token) throw new Error("Template management requires the storage broker capability");

const storage = new BrokeredStorage({
  socketPath,
  token,
});
const bodies = new BrokeredMarkdownObjectStore(storage);

await runTemplateCommand(
  action,
  templateName,
  extraArguments.includes("--force-template"),
  bodies,
  process.env.CONTEXT_USE_DEVELOPMENT_TEMPLATE_ROOT,
);
