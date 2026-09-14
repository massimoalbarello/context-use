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
  const observations = { recallCalls: 0, mainCalls: 0, prompt: '', tools: new Set<string>() };
  let phase: 'learn' | 'recall' | 'excluded' = 'learn';
  let guideVersion: string | undefined;
  let mainStep = 0;
  let recallStep = 0;
  type ModelInput = z.infer<typeof RequestSchema>;
  type Reply = { call?: { name: string; arguments: Record<string, unknown> }; answer: string };
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
  function reply(input: ModelInput): Reply {
    const names = input.tools.map((tool) => tool.function.name);
    if (phase === 'excluded') {
      assert(
        !names.some((name) => name.startsWith('context_use_')),
        'Personal memory reached an excluded group',
      );
      return { answer: 'Personal memory is unavailable in this group.' };
    }
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
      assert(
        !names.includes('memory_search') && !names.includes('memory_get'),
        'A competing memory provider is available',
      );
      const prompt = JSON.stringify(input.messages);
      assert(!prompt.includes('LOCAL_MEMORY_CANARY'), 'Local personal memory reached the model');
      const { call, answer } = reply(input);
      const toolName = call ? `context_use_${call.name}` : undefined;
      if (toolName) {
        assert(names.includes(toolName), `Native tool ${toolName} is unavailable`);
        observations.tools.add(toolName);
      }
      const properties =
        input.tools.find((tool) => tool.function.name === toolName)?.function.parameters
          .properties ?? {};
      // Reproduce providers that require every field: unspecified inputs must
      // have an omission value, including cursors, search filters and updates.
      const args = call
        ? {
            ...Object.fromEntries(Object.keys(properties).map((key) => [key, null])),
            ...call.arguments,
          }
        : undefined;
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
    recall: () => {
      phase = 'recall';
      recallStep = 0;
    },
    exclude: () => {
      phase = 'excluded';
    },
    stop: () => server.stop(true),
  };
}
