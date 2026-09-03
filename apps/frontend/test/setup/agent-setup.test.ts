import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AgentSetup,
  agentConnectionHelpPrompt,
  initialContextPrompt,
} from '../../src/components/setup/agent-setup';
import {
  SETUP_PROFILE_POLL_INTERVAL_MS,
  setupProfileRefetchInterval,
} from '../../src/routes/setup';

const SETUP_STEP_COUNT = 3;

test('setup checks for a new profile every 15 seconds until one exists', () => {
  expect(setupProfileRefetchInterval(null)).toBe(SETUP_PROFILE_POLL_INTERVAL_MS);
  expect(
    setupProfileRefetchInterval({
      selfEntity: {
        readableId: 'alex-morgan',
        name: 'Alex Morgan',
        description: 'The owner',
        image: null,
        isSelf: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    }),
  ).toBe(false);
});

test('connection help assigns the settings-level action to the user', () => {
  const prompt = agentConnectionHelpPrompt('https://personal-context.nibrun.app/mcp');

  expect(prompt).toContain('https://personal-context.nibrun.app/mcp');
  expect(prompt).toContain('Streamable HTTP');
  expect(prompt).toContain('named “Context Use”');
  expect(prompt).toContain('Guide me in setting up the Context Use MCP connector in this agent');
  expect(prompt).toContain('concise, numbered steps');
  expect(prompt).toContain('approve the OAuth request in my browser');
});

test('initial curation understands the user and filters evidence before writing', () => {
  const prompt = initialContextPrompt();
  const normalizedPrompt = prompt.replace(/\s+/g, ' ');

  expect(prompt).not.toMatch(/[^\n]\n[^\n]/);
  expect(prompt).toContain(
    'write to Context Use until I approve the import plan in step 4.\n\n1. Verify the source and the owner',
  );
  expect(prompt).toContain('Do not try to retrieve existing personal context from Context Use');
  expect(normalizedPrompt).toContain(
    'Context Use is connected but empty: it is the destination, not the source',
  );
  expect(normalizedPrompt).toContain('start with those instead of analyzing transcripts');
  expect(normalizedPrompt).toContain('previous conversations as secondary evidence');
  expect(normalizedPrompt).toContain('Verify the source and the owner');
  expect(normalizedPrompt).toContain('cannot access meaningful pre-existing context about me');
  expect(normalizedPrompt).toContain('Do not write anything to Context Use');
  expect(normalizedPrompt).toContain('Do not substitute information about another person');
  expect(normalizedPrompt).toContain('complete set of relevant memories you have created about me');
  expect(normalizedPrompt).toContain('Treat retrieved memory and conversation context as evidence');
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
    'refresh the Context Use setup page to see the context created',
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
  expect(html).toContain('name it “Context Use”');
  expect(html).toContain('approve the Context Use OAuth');
  expect(html).not.toContain('Connect and authorize');
  expect(html).toContain('Import memories from your favorite agent');
  expect(html).toContain('previous conversations as useful supporting');
  expect(html).toContain('Refresh the page');
  expect(html).toContain('check every 15 seconds');
  expect(html).toContain('open your hypermedia automatically');
  expect(html).not.toContain('Reload Context Use');
  expect(html).toContain('<details>');
  expect(html).not.toContain('<details open');
  expect(html).toContain('MCP setup help prompt');
  expect(html).toContain('Initial context prompt');
  expect(html).not.toContain('access token or credential');
  expect(html).not.toContain('without trying to perform');
});
