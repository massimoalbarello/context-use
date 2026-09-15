import assert from 'node:assert/strict';
import { z } from 'zod';

const RequestSchema = z.object({
  messages: z.array(
    z.object({ role: z.string(), content: z.unknown(), name: z.string().optional() }).passthrough(),
  ),
  tools: z
    .array(
      z.object({
        function: z
          .object({
            name: z.string(),
            parameters: z.object({ properties: z.record(z.string(), z.unknown()).default({}) }),
          })
          .passthrough(),
      }),
    )
    .default([]),
});
const BAD_REQUEST = 400;
const PAGE_ADDRESS = 'context-use://page/miras-studies';
const ToolPayloadSchema = z.object({ guide_version: z.string().optional() }).passthrough();

/** Only the external model is scripted: OpenClaw, OAuth, MCP and persistence stay real. */
export function startModel() {
  const observations = {
    recallCalls: 0,
    mainCalls: 0,
    removedCalls: 0,
    setupCalls: 0,
    prompt: '',
    tools: new Set<string>(),
  };
  let phase: 'setup' | 'learn' | 'recall' | 'removed' = 'learn';
  let setupCommand = '';
  let setupStarted = false;
  let setupSession: string | undefined;
  let guideVersion: string | undefined;
  let mainStep = 0;
  let recallStep = 0;
  type ModelInput = z.infer<typeof RequestSchema>;
  type Reply = { call?: { name: string; arguments: Record<string, unknown> }; answer: string };
  function setupReply(input: ModelInput): Reply {
    observations.setupCalls += 1;
    if (!setupStarted) {
      setupStarted = true;
      return {
        call: {
          name: 'exec',
          arguments: { command: setupCommand, yieldMs: 120000, timeoutSeconds: 180 },
        },
        answer: '',
      };
    }
    const output = JSON.stringify(
      input.messages.filter((message) => message.role === 'tool').at(-1)?.content,
    );
    setupSession ??= output.match(/Command still running \(session ([^,]+),/)?.[1];
    if (setupSession && !output.includes('Process exited with code 0')) {
      assert(
        !/Process exited with (?:code [1-9]|signal)/.test(output),
        'Agent setup process failed',
      );
      return {
        call: {
          name: 'process',
          arguments: { action: 'poll', sessionId: setupSession, timeout: 30000 },
        },
        answer: '',
      };
    }
    assert(
      output.includes('Open this URL') || output.includes('Context Use connected'),
      `Agent setup command did not complete: ${output}`,
    );
    return { answer: 'Plugin setup completed; follow the authorization instructions.' };
  }
  function recallReply(input: ModelInput): Reply {
    const names = input.tools.map((tool) => tool.function.name);
    let call: Reply['call'];
    let answer = 'Mira studies architecture.';
    observations.recallCalls += 1;
    assert(
      names.includes('context_use_search_hypermedia'),
      `Active Memory needs native Context Use tools; available: ${names.join(', ')}`,
    );
    if (recallStep === 0) {
      call = { name: 'search_hypermedia', arguments: { query: 'sister' } };
    } else if (recallStep === 1) {
      call = { name: 'search_hypermedia', arguments: { query: 'Mira' } };
    } else if (recallStep === 2 && phase === 'recall') {
      call = { name: 'read_knowledge_page', arguments: { address: PAGE_ADDRESS } };
    } else {
      if (phase === 'recall') {
        const result = input.messages.filter((message) => message.role === 'tool').at(-1);
        assert(
          JSON.stringify(result?.content).includes('architecture'),
          'Remote page read did not return the saved memory',
        );
      }
      answer =
        phase === 'learn'
          ? 'NONE'
          : 'The user’s sister Mira studies architecture (context-use://page/miras-studies).';
    }
    recallStep += 1;

    return { call, answer };
  }
  function mainReply(input: ModelInput): Reply {
    const prompt = JSON.stringify(input.messages);
    let call: Reply['call'];
    observations.mainCalls += 1;
    observations.prompt = prompt;
    assert(prompt.includes('sole durable personal memory'), 'Native memory guidance missing');
    if (phase === 'learn') {
      for (const message of input.messages.filter(
        (message) => message.role === 'tool' && typeof message.content === 'string',
      )) {
        try {
          const payload = ToolPayloadSchema.parse(JSON.parse(message.content as string));
          guideVersion ??= payload.guide_version;
        } catch {
          /* Other tool result shapes do not contain the guide. */
        }
      }
      const steps = [
        { name: 'read_knowledge_page', arguments: { address: 'context-use://page/missing-page' } },
        { name: 'read_hypermedia_curation_guide', arguments: {} },
        { name: 'search_hypermedia', arguments: { query: 'Rowan Mira' } },
        {
          name: 'create_entity',
          arguments: {
            name: 'Rowan',
            description: 'The user.',
            entityType: { value: 'person' },
            isSelf: true,
          },
        },
        {
          name: 'create_entity',
          arguments: {
            name: 'Mira',
            description: 'Rowan’s sister, studying architecture.',
            entityType: { value: 'person' },
          },
        },
        {
          name: 'create_knowledge_page',
          arguments: {
            guide_version: guideVersion,
            markdown:
              '# Mira’s studies\n\n[Rowan](context-use://entity/rowan) reported that their sister [Mira](context-use://entity/mira) studies architecture. Source: the current conversation.',
          },
        },
      ];
      call = steps[mainStep];
      mainStep += 1;
    } else {
      assert(
        prompt.includes('Mira studies architecture') ||
          prompt.includes('sister Mira studies architecture'),
        'Recall did not reach the main agent',
      );
    }

    return { call, answer: 'Mira studies architecture.' };
  }
  function removedReply(input: ModelInput): Reply {
    const names = input.tools.map((tool) => tool.function.name);
    const prompt = JSON.stringify(input.messages);
    assert(
      !names.some((name) => name.startsWith('context_use_')),
      'Removed plugin still exposes tools',
    );
    assert(names.includes('memory_search'), 'Native memory was not restored');
    assert(
      !prompt.includes('sole durable personal memory'),
      'Stale provider policy reached a fresh chat',
    );
    assert(
      !prompt.includes('context_use_'),
      'Stale provider tool instructions reached a fresh chat',
    );
    assert(
      prompt.includes('Rowan is building Context Use'),
      'Removal erased ordinary project facts',
    );
    assert(prompt.includes('Keep my later style edit'), 'Removal erased later user edits');
    observations.removedCalls += 1;
    return { answer: 'Local memory is available. You are Rowan and like architecture.' };
  }
  function reply(input: ModelInput): Reply {
    if (phase === 'setup') {
      return setupReply(input);
    }
    if (phase === 'removed') {
      return removedReply(input);
    }
    const names = input.tools.map((tool) => tool.function.name);
    assert(
      !names.includes('memory_search') && !names.includes('memory_get'),
      'A competing memory provider is available',
    );
    assert(
      !JSON.stringify(input.messages).includes('LOCAL_MEMORY_CANARY'),
      'Local personal memory reached the model',
    );
    return names.includes('context_use_create_knowledge_page')
      ? mainReply(input)
      : recallReply(input);
  }
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    error: (error) =>
      Response.json(
        { error: { message: error.message, type: 'invalid_request_error' } },
        { status: BAD_REQUEST },
      ),
    async fetch(request) {
      const input = RequestSchema.parse(await request.json());
      const names = input.tools.map((tool) => tool.function.name);
      const { call, answer } = reply(input);
      const toolName = call
        ? phase === 'setup'
          ? call.name
          : `context_use_${call.name}`
        : undefined;
      if (toolName) {
        assert(names.includes(toolName), `Native tool ${toolName} is unavailable`);
        observations.tools.add(toolName);
      }
      const properties =
        input.tools.find((tool) => tool.function.name === toolName)?.function.parameters
          .properties ?? {};
      // Reproduce providers that require every field: unspecified inputs must
      // have an omission value, including cursors, search filters and updates.
      const args =
        call && phase !== 'setup'
          ? {
              ...Object.fromEntries(Object.keys(properties).map((key) => [key, null])),
              ...call.arguments,
            }
          : call?.arguments;
      const delta = call
        ? {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: `call_${crypto.randomUUID()}`,
                type: 'function',
                function: { name: toolName, arguments: JSON.stringify(args) },
              },
            ],
          }
        : { role: 'assistant', content: answer };
      const chunk = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
      const base = {
        id: 'fixture',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'memory-fixture',
      };
      return new Response(
        chunk({ ...base, choices: [{ index: 0, delta, finish_reason: null }] }) +
          chunk({
            ...base,
            choices: [{ index: 0, delta: {}, finish_reason: call ? 'tool_calls' : 'stop' }],
          }) +
          'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  return {
    origin: `http://127.0.0.1:${server.port}`,
    observations,
    setup: (command: string) => {
      phase = 'setup';
      setupCommand = command;
      setupStarted = false;
      setupSession = undefined;
    },
    learn: () => {
      phase = 'learn';
      mainStep = 0;
      recallStep = 0;
    },
    recall: () => {
      phase = 'recall';
      recallStep = 0;
    },
    removed: () => {
      phase = 'removed';
    },
    stop: () => server.stop(true),
  };
}
