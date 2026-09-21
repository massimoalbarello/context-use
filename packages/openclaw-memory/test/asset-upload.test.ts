import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uploadAttachment } from '../src/asset-upload';
import { writeState } from '../src/state';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'asset-upload-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  let bytes: Buffer | undefined;
  let name = '';
  let uploads = 0;
  let downloads = 0;
  let loseResponse = false;
  let externalDestination = false;
  const secret = 'single-use-fixture-capability';
  const asset = () => ({
    address: 'context-use://asset/exhibition',
    name,
    mediaType: 'application/pdf',
    sizeBytes: bytes!.length,
  });
  type Rpc = {
    id?: number;
    method: string;
    params?: { name: string; arguments: { name?: string; changeMessage?: string } };
  };
  const payloadFor = (input: { rpc: Rpc; origin: string }) => {
    const handlers: Record<string, () => unknown> = {
      list_assets: () => ({ items: bytes ? [asset()] : [], nextCursor: null }),
      read_asset: () => ({
        ...asset(),
        download: {
          method: 'GET',
          url: `${input.origin}/download`,
          requiredHeaders: { 'x-transfer': secret },
        },
      }),
      create_asset_upload: () => {
        expect(input.rpc.params!.arguments.changeMessage).toBe(
          'Saved an attachment from the conversation',
        );
        name = input.rpc.params!.arguments.name!;
        return {
          method: 'PUT',
          url: externalDestination ? 'https://example.invalid/upload' : `${input.origin}/upload`,
          requiredHeaders: { 'content-type': 'application/octet-stream', 'x-transfer': secret },
        };
      },
    };
    return handlers[input.rpc.params!.name]!();
  };
  const handleTransfer = async (request: Request) => {
    const url = new URL(request.url);
    expect(request.headers.get('x-transfer')).toBe(secret);
    expect(url.search).toBe('');
    if (url.pathname === '/download') {
      downloads += 1;
      return new Response(new Uint8Array(bytes!));
    }
    expect(request.headers.get('content-type')).toBe('application/octet-stream');
    uploads += 1;
    bytes = Buffer.from(await request.arrayBuffer());
    if (loseResponse) {
      loseResponse = false;
      return new Response('response lost after save', { status: 500 });
    }
    return Response.json(asset(), { status: 201 });
  };
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname !== '/mcp') {
        return handleTransfer(request);
      }
      if (request.method !== 'POST') {
        const noContent = 204;
        return new Response(null, { status: noContent });
      }
      const rpc = (await request.json()) as Rpc;
      if (rpc.id === undefined) {
        return new Response(null, { status: 202 });
      }
      const payload =
        rpc.method === 'initialize' ? undefined : payloadFor({ rpc, origin: url.origin });
      const result =
        rpc.method === 'initialize'
          ? {
              protocolVersion: '2025-11-25',
              capabilities: { tools: {} },
              serverInfo: { name: 'asset-transfer-fixture', version: '1' },
            }
          : {
              content: [{ type: 'text', text: JSON.stringify(payload) }],
              structuredContent: payload,
            };
      return Response.json({ jsonrpc: '2.0', id: rpc.id, result });
    },
  });
  cleanups.push(async () => {
    await server.stop(true);
  });
  const config = { agentId: 'main', serverUrl: `${server.url.origin}/mcp` };
  const connectionId = '00000000-0000-4000-8000-000000000001';
  await writeState({
    directory,
    state: {
      config,
      learningId: connectionId,
      changes: [],
      tools: [],
      oauth: {
        client: { client_id: 'owner' },
        tokens: { access_token: 'test', token_type: 'Bearer' },
      },
    },
  });
  return {
    save: (content: string) =>
      uploadAttachment({
        directory,
        config,
        connectionId,
        name: 'Exhibition document',
        bytes: Buffer.from(content),
      }),
    loseResponse: () => {
      loseResponse = true;
    },
    externalDestination: () => {
      externalDestination = true;
    },
    get uploads() {
      return uploads;
    },
    get downloads() {
      return downloads;
    },
    get bytes() {
      return bytes;
    },
  };
}

test('uploads original bytes and recovers an uncertain save without creating another asset', async () => {
  const f = await fixture();
  f.loseResponse();
  await expect(f.save('%PDF fixture bytes')).rejects.toThrow('transfer failed');
  expect(f.bytes).toEqual(Buffer.from('%PDF fixture bytes'));
  expect((await f.save('%PDF fixture bytes')).address).toBe('context-use://asset/exhibition');
  expect(f.uploads).toBe(1);
  expect(f.downloads).toBe(1);
  await expect(f.save('%PDF another bytes')).rejects.toThrow('different asset');
  expect(f.uploads).toBe(1);
});

test('attachment transfer credentials and bytes never follow a different origin', async () => {
  const f = await fixture();
  f.externalDestination();
  await expect(f.save('private document')).rejects.toThrow(
    'invalid attachment transfer destination',
  );
  expect(f.uploads).toBe(0);
});
