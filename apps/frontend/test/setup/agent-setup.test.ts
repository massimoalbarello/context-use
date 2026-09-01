import { expect, test } from 'bun:test';
import { agentSetupPrompt } from '../../src/components/setup/agent-setup';

test('agent-assisted setup stays small, creates self first, and returns attention to Context Use', () => {
  const prompt = agentSetupPrompt({
    applicationUrl: 'https://personal-context.nibrun.app',
    mcpServerUrl: 'https://personal-context.nibrun.app/mcp',
  });

  expect(prompt).toContain('https://personal-context.nibrun.app/mcp');
  expect(prompt).toContain('create_entity with isSelf set to true');
  expect(prompt).toContain('at most five additional entities');
  expect(prompt).toContain('at most three knowledge pages');
  expect(prompt).toContain('Do not perform broad external research');
  expect(prompt).toContain('Do not upload assets during this first pass');
  expect(prompt).toContain('https://personal-context.nibrun.app/pages');
  expect(prompt).toContain('create my first entity manually');
  expect(prompt).toContain('https://personal-context.nibrun.app/entities/new');
  expect(prompt).toContain("in this agent's MCP settings");
  expect(prompt).toContain('Do not begin that deeper pass without my approval');
});
