import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AgentSetup,
  agentConnectionHelpPrompt,
  initialContextPrompt,
} from '../../src/components/setup/agent-setup';

test('connection help assigns the settings-level action to the user', () => {
  const prompt = agentConnectionHelpPrompt('https://personal-context.nibrun.app/mcp');

  expect(prompt).toContain('https://personal-context.nibrun.app/mcp');
  expect(prompt).toContain('Streamable HTTP');
  expect(prompt).toContain('app-specific steps');
  expect(prompt).toContain('settings-level action I must perform');
  expect(prompt).toContain('Do not try to register or connect the server yourself');
  expect(prompt).toContain('approve the OAuth request in my browser');
});

test('initial curation understands the user and filters evidence before writing', () => {
  const prompt = initialContextPrompt('https://personal-context.nibrun.app');

  expect(prompt).toContain('do not write to Context Use until steps 1–3 are complete');
  expect(prompt).toContain('Understand me before modeling me');
  expect(prompt).toContain(
    'reliably identifies me as the person who owns this Context Use instance',
  );
  expect(prompt).toContain('If you cannot reliably identify me, stop');
  expect(prompt).toContain('Do not write anything to Context Use');
  expect(prompt).toContain('do not substitute information about another person');
  expect(prompt).toContain('Focus on me');
  expect(prompt).toContain('evidence, confidence, durability, sensitivity');
  expect(prompt).toContain('materially help a future agent understand me');
  expect(prompt).toContain('Does this feel recognizably about this person');
  expect(prompt).toContain('ask me up to three focused questions');
  expect(prompt).toContain('read_hypermedia_curation_guide');
  expect(prompt).toContain('create_entity with isSelf set to true');
  expect(prompt).toContain('at most five additional entities');
  expect(prompt).toContain('at most three knowledge pages');
  expect(prompt).toContain('Do not perform broad external research');
  expect(prompt).toContain('Do not upload assets during this first pass');
  expect(prompt).toContain('https://personal-context.nibrun.app/entities');
  expect(prompt).toContain('Do not begin that deeper pass without my approval');
});

test('setup presents the user-owned connection flow as four numbered steps', () => {
  const html = renderToStaticMarkup(
    createElement(AgentSetup, {
      applicationUrl: 'https://personal-context.nibrun.app',
      mcpServerUrl: 'https://personal-context.nibrun.app/mcp',
    }),
  );

  expect(html).toContain('<ol');
  expect(html).toContain('Add the MCP server');
  expect(html).toContain('Connect and authorize');
  expect(html).toContain('Bootstrap your context');
  expect(html).toContain('Reload and review');
  expect(html).toContain('Reload Context Use');
  expect(html).toContain('<details>');
  expect(html).not.toContain('<details open');
  expect(html).toContain('MCP setup help prompt');
  expect(html).toContain('Initial context prompt');
  expect(html).not.toContain('access token or credential');
});
