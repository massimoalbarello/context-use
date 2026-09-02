import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AgentSetup,
  agentConnectionHelpPrompt,
  initialContextPrompt,
} from '../../src/components/setup/agent-setup';

const SETUP_STEP_COUNT = 3;

test('connection help assigns the settings-level action to the user', () => {
  const prompt = agentConnectionHelpPrompt('https://personal-context.nibrun.app/mcp');

  expect(prompt).toContain('https://personal-context.nibrun.app/mcp');
  expect(prompt).toContain('Streamable HTTP');
  expect(prompt).toContain('Guide me in setting up the Context Use MCP connector in this agent');
  expect(prompt).toContain('concise, numbered steps');
  expect(prompt).toContain('approve the OAuth request in my browser');
});

test('initial curation understands the user and filters evidence before writing', () => {
  const prompt = initialContextPrompt();
  const normalizedPrompt = prompt.replace(/\s+/g, ' ');

  expect(normalizedPrompt).toContain(
    'Context Use is connected but empty: it is the destination, not the source',
  );
  expect(normalizedPrompt).toContain('your own stored memories about me');
  expect(normalizedPrompt).toContain('past conversations');
  expect(normalizedPrompt).toContain('Verify the source and the owner');
  expect(normalizedPrompt).toContain('cannot access meaningful pre-existing memory about me');
  expect(normalizedPrompt).toContain('Do not write anything to Context Use');
  expect(normalizedPrompt).toContain('Do not substitute information about another person');
  expect(normalizedPrompt).toContain('Review the complete set of relevant memory');
  expect(normalizedPrompt).toContain('Treat retrieved memory as evidence for this import');
  expect(normalizedPrompt).toContain('evidence, confidence, durability, sensitivity');
  expect(normalizedPrompt).toContain('materially help a future agent understand me');
  expect(normalizedPrompt).toContain('Does this feel recognizably about this person');
  expect(normalizedPrompt).toContain('ask me up to three focused questions');
  expect(normalizedPrompt).toContain('read_hypermedia_curation_guide');
  expect(normalizedPrompt).toContain('Show me the import plan');
  expect(normalizedPrompt).toContain('Ask for my approval and wait for it');
  expect(normalizedPrompt).toContain('create_entity with isSelf set to true');
  expect(normalizedPrompt).toContain('at most five additional entities');
  expect(normalizedPrompt).toContain('at most three knowledge pages');
  expect(normalizedPrompt).toContain('Do not perform broad external research');
  expect(normalizedPrompt).toContain('Do not upload assets during this first pass');
  expect(normalizedPrompt).toContain(
    'reload the Context Use setup page to see the context created',
  );
  expect(normalizedPrompt).toContain('Do not begin that deeper pass without my approval');
});

test('setup presents the user-owned connection flow as three numbered steps', () => {
  const html = renderToStaticMarkup(
    createElement(AgentSetup, {
      mcpServerUrl: 'https://personal-context.nibrun.app/mcp',
    }),
  );

  expect(html).toContain('<ol');
  expect([...html.matchAll(/<li/g)]).toHaveLength(SETUP_STEP_COUNT);
  expect(html).toContain('Connect to the MCP server');
  expect(html).toContain('approve the Context Use OAuth');
  expect(html).not.toContain('Connect and authorize');
  expect(html).toContain('Bootstrap your context');
  expect(html).toContain('Reload and review');
  expect(html).toContain('reload this page to see the context created');
  expect(html).not.toContain('Reload Context Use');
  expect(html).toContain('<details>');
  expect(html).not.toContain('<details open');
  expect(html).toContain('MCP setup help prompt');
  expect(html).toContain('Initial context prompt');
  expect(html).not.toContain('access token or credential');
  expect(html).not.toContain('without trying to perform');
});
