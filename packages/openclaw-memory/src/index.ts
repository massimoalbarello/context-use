/** biome-ignore-all lint/complexity/useMaxParams: OpenClaw callbacks use positional arguments. */

import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { resolveAgentWorkspaceDir } from 'openclaw/plugin-sdk/agent-runtime';
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { z } from 'zod';
import { callMemoryTool } from './client';
import { configMatches } from './configuration';
import { assertHostVersion, PLUGIN_ID, PluginConfigSchema, toolName } from './contract';
import { registerLearning } from './learning';
import { canUseMemory, filterBootstrap, isMemoryPath, memoryCapability } from './lifecycle';
import { type ConnectionState, connectionDirectory, readStateSync } from './state';
import { toolInput } from './tool-input';

const BootstrapSchema = z.object({
  workspaceDir: z.string(),
  bootstrapFiles: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      missing: z.boolean(),
      content: z.string().optional(),
    }),
  ),
});

export default definePluginEntry({
  id: PLUGIN_ID,
  name: 'Context Use Memory',
  description: 'Context Use as the sole durable personal memory',
  configSchema: { jsonSchema: z.toJSONSchema(PluginConfigSchema) },
  register(api) {
    api.registerCli(
      ({ program }) => {
        program
          .command('context-use')
          .description('Manage Context Use memory; pass --help for setup instructions')
          .argument('[args...]')
          .helpOption(false)
          .allowUnknownOption()
          .action(async (args: string[]) => {
            const child = spawn(
              process.execPath,
              [join(dirname(api.source), 'setup.js'), ...args],
              {
                stdio: 'inherit',
              },
            );
            await new Promise<void>((resolve, reject) => {
              child.once('error', reject);
              child.once('exit', (code) => {
                process.exitCode = code ?? 1;
                resolve();
              });
            });
          });
      },
      { commands: ['context-use'] },
    );
    if (api.registrationMode === 'cli-metadata' || api.registrationMode === 'setup-only') {
      return;
    }
    assertHostVersion(api.runtime.version);
    const config = PluginConfigSchema.parse(api.pluginConfig);
    const directory = connectionDirectory();
    api.registerMemoryCapability(memoryCapability(config.agentId));
    const workspaceDir = resolveAgentWorkspaceDir(api.config, config.agentId);
    api.registerHook(
      'agent:bootstrap',
      (event) => {
        if (!event.sessionKey?.startsWith(`agent:${config.agentId}:`)) {
          return;
        }
        const parsed = BootstrapSchema.safeParse(event.context);
        if (!parsed.success) {
          throw new Error('Unsupported OpenClaw bootstrap context.');
        }
        filterBootstrap({
          files: parsed.data.bootstrapFiles,
          workspaceDir: parsed.data.workspaceDir,
        });
        event.context.bootstrapFiles = parsed.data.bootstrapFiles;
      },
      { name: 'context-use-bootstrap', description: 'Exclude competing personal memory files' },
    );
    api.on('before_tool_call', (event, context) => {
      if (context.agentId !== config.agentId) {
        return;
      }
      const paths = [
        ...(event.derivedPaths ?? []),
        ...['path', 'file_path'].flatMap((key) =>
          typeof event.params[key] === 'string' ? [event.params[key] as string] : [],
        ),
      ];
      if (
        ['memory_search', 'memory_get'].includes(event.toolName) ||
        paths.some((path) => isMemoryPath({ path: resolve(workspaceDir, path), workspaceDir }))
      ) {
        return {
          block: true,
          blockReason: 'Use Context Use for personal memory. Local memory files are disabled.',
        };
      }
    });
    let state: ConnectionState | undefined;
    try {
      state = readStateSync(directory);
    } catch {
      api.logger.warn(
        'Context Use connection state is unreadable. Personal memory remains unavailable until repaired.',
      );
      return;
    }
    if (!state?.oauth.tokens || !configMatches({ actual: state.config, expected: config })) {
      api.logger.warn(
        'Context Use is disconnected. Run openclaw context-use connect <instance-url>.',
      );
      return;
    }
    if (state.learningId) {
      registerLearning({
        connectionId: state.learningId,
        api,
        config,
        directory,
        toolNames: state.tools.map((tool) => toolName(tool.name)),
      });
    } else {
      api.logger.warn('Reconnect Context Use to enable background learning.');
    }
    api.registerTool(
      (context) => {
        if (!canUseMemory({ ...config, context })) {
          return null;
        }
        return state.tools.map((tool) => {
          const input = toolInput(tool.inputSchema);
          return {
            name: toolName(tool.name),
            label: tool.title ?? tool.name,
            description: tool.description ?? tool.name,
            parameters: input.parameters,
            execute: async (_id, args, signal) => {
              try {
                const result = await callMemoryTool({
                  directory,
                  connectionId: state.learningId,
                  ...config,
                  name: tool.name,
                  arguments: input.parse(args),
                  signal,
                });
                return {
                  content: result.content.map((item) =>
                    item.type === 'text' || item.type === 'image'
                      ? item
                      : { type: 'text' as const, text: JSON.stringify(item) },
                  ),
                  details: {
                    ...(result.isError ? { status: 'error' } : {}),
                    structuredContent: result.structuredContent,
                  },
                };
              } catch {
                return {
                  content: [
                    {
                      type: 'text' as const,
                      text: 'Context Use could not complete this operation. Run openclaw context-use status. Do not assume a write failed or retry a create without searching.',
                    },
                  ],
                  details: { status: 'error' },
                };
              }
            },
          };
        });
      },
      { names: state.tools.map((tool) => toolName(tool.name)) },
    );
  },
});
