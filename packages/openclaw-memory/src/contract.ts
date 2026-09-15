import { satisfies } from 'semver';
import { z } from 'zod';
import packageJson from '../package.json';
import { ConnectionError } from './error';

export const PLUGIN_ID = 'context-use';
export const PACKAGE_VERSION = packageJson.version;
export const OPENCLAW_VERSION_RANGE = packageJson.peerDependencies.openclaw;
export const CALLBACK_URL = 'http://127.0.0.1:49187/context-use/callback';
export const REQUEST_TIMEOUT_MS = 30_000;
export const AUTHORIZATION_TIMEOUT_MS = 600_000;
export const toolName = (name: string) => `context_use_${name}`;

export const PluginConfigSchema = z.strictObject({
  agentId: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  serverUrl: z.url(),
});
export type PluginConfig = z.infer<typeof PluginConfigSchema>;

export function serverUrl(input: string): string {
  const url = new URL(input);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new ConnectionError(
      'Use an HTTPS instance URL (HTTP is allowed only for local development).',
    );
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['/', '/mcp'].includes(url.pathname)
  ) {
    throw new ConnectionError(
      'Supply the instance origin or its /mcp endpoint, without credentials or query parameters.',
    );
  }
  return new URL('/mcp', url).href;
}

export function assertHostVersion(version: string): void {
  if (!satisfies(version, OPENCLAW_VERSION_RANGE)) {
    throw new ConnectionError(
      `This plugin requires OpenClaw ${OPENCLAW_VERSION_RANGE}; found ${version}.`,
    );
  }
}

// The plugin's public surface is explicit; schemas still come from MCP discovery.
// New server tools are not automatically granted to the agent.
export const MCP_TOOL_NAMES = [
  'create_asset_upload',
  'list_assets',
  'read_asset',
  'update_asset',
  'archive_asset',
  'create_entity',
  'list_entities',
  'read_entity',
  'update_entity',
  'archive_entity',
  'search_hypermedia',
  'read_hypermedia_curation_guide',
  'create_knowledge_page',
  'list_knowledge_pages',
  'read_knowledge_page',
  'update_knowledge_page',
  'archive_knowledge_page',
  'read_record',
] as const;
