import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AgentSetup,
  agentConnectionHelpPrompt,
  initialContextPrompt,
} from '../../src/components/setup/agent-setup';
import {
  hypermediaPathAfterSelfEntityCreation,
  SETUP_PROFILE_POLL_INTERVAL_MS,
  setupProfileRefetchInterval,
} from '../../src/routes/setup';

const SETUP_STEP_COUNT = 3;

test('setup checks for a new profile every 15 seconds until one exists', () => {
  const profile = {
    selfEntity: {
      readableId: 'alex-morgan',
      name: 'Alex Morgan',
      description: 'The owner',
      image: null,
      isSelf: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  expect(setupProfileRefetchInterval(null)).toBe(SETUP_PROFILE_POLL_INTERVAL_MS);
  expect(hypermediaPathAfterSelfEntityCreation(undefined)).toBeNull();
  expect(setupProfileRefetchInterval(profile)).toBe(false);
  expect(hypermediaPathAfterSelfEntityCreation(profile.selfEntity)).toBe('/hypermedia');
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
  expect(normalizedPrompt).toContain('This vault is guaranteed to be empty');
  expect(normalizedPrompt).toContain(
    'Do not call list_entities, list_knowledge_pages, list_assets',
  );
  expect(normalizedPrompt).toContain(
    'duplicate-inspection step does not apply to this initial bootstrap',
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
  expect(normalizedPrompt).toContain('Do not stop after an arbitrary handful of entities or pages');
  expect(normalizedPrompt).toContain('do not impose a numeric cap');
  expect(normalizedPrompt).not.toContain('at most five additional entities');
  expect(normalizedPrompt).not.toContain('at most three knowledge pages');
  expect(normalizedPrompt).toContain('Do not perform broad external research');
  expect(normalizedPrompt).toContain('create_asset_upload');
  expect(normalizedPrompt).toContain('imageAssetAddress');
  expect(normalizedPrompt).toContain('upload pictures of myself or those people');
  expect(normalizedPrompt).toContain('optional and will help visualize my context in Context Use');
  expect(normalizedPrompt).toContain('ask me to attach and identify each image');
  expect(normalizedPrompt).toContain('Never source substitute portraits from the web');
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
  expect(html).toContain('Connect your agent to Context Use MCP server');
  expect(html).toContain('Server name');
  expect(html).toContain('Context Use');
  expect(html).toContain('Server URL');
  expect(html).toContain('https://personal-context.nibrun.app/mcp');
  expect(html).toContain('Copy server name');
  expect(html).toContain('Copy server URL');
  expect(html).not.toContain('Open your agent’s MCP or connector settings');
  expect(html).not.toContain('Connect and authorize');
  expect(html).toContain('Import memories from your favorite agent');
  expect(html).toContain('user context already available to your agent');
  expect(html).toContain('Refresh the page');
  expect(html).toContain('Refresh this page when the import is complete');
  expect(html).not.toContain('check every 15 seconds');
  expect(html).not.toContain('open your hypermedia automatically');
  expect(html).not.toContain('Reload Context Use');
  expect(html).toContain('<details>');
  expect(html).not.toContain('<details open');
  expect(html).toContain('MCP setup help prompt');
  expect(html).toContain('Initial context prompt');
  expect(html).not.toContain('access token or credential');
  expect(html).not.toContain('without trying to perform');
});
