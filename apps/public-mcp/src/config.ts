import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  PUBLIC_MCP_ENDPOINT: z.string().url().default("http://localhost:3001/mcp"),
  PUBLIC_SITE_ORIGIN: z.string().url().default("http://localhost:5173"),
  PUBLIC_MCP_DATABASE_URL: z.string().min(1).default(
    "postgres://context_use_public_mcp:development-only@localhost:5432/context_use",
  ),
});

export const config = schema.parse(process.env);

function parsedUrl(value: string, label: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
}

const database = parsedUrl(config.PUBLIC_MCP_DATABASE_URL, "PUBLIC_MCP_DATABASE_URL");
if (!database.protocol.startsWith("postgres") || decodeURIComponent(database.username) !== "context_use_public_mcp") {
  throw new Error("PUBLIC_MCP_DATABASE_URL must use the context_use_public_mcp role");
}

const endpoint = parsedUrl(config.PUBLIC_MCP_ENDPOINT, "PUBLIC_MCP_ENDPOINT");
if (endpoint.search || endpoint.hash) {
  throw new Error("PUBLIC_MCP_ENDPOINT must not contain a query or fragment");
}

const site = parsedUrl(config.PUBLIC_SITE_ORIGIN, "PUBLIC_SITE_ORIGIN");
if (site.pathname !== "/" || site.search || site.hash) {
  throw new Error("PUBLIC_SITE_ORIGIN must contain only a scheme and host");
}
if (config.NODE_ENV === "production") {
  if (endpoint.protocol !== "https:" || site.protocol !== "https:") {
    throw new Error("Public MCP production URLs must use HTTPS");
  }
  if (endpoint.origin !== site.origin) {
    throw new Error("PUBLIC_MCP_ENDPOINT and PUBLIC_SITE_ORIGIN must share an origin");
  }
}

export const publicMcpEndpoint = endpoint;
export const publicSiteOrigin = site.origin;
