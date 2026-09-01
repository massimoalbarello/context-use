import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import type { SQL } from 'bun';
import { StatusMap } from 'elysia';
import { createSqliteDatabase } from '#db/client.ts';
import { runMigrations } from '#db/migrate.ts';
import { OWNER_SYNTHETIC_EMAIL, OWNER_USER_ID } from '#lib/auth/owner-registration.ts';
import { LocalStorage } from '#lib/storage/local-storage.ts';
import { type Asset, MAX_ASSET_BYTES } from '#models/assets/model.ts';
import type { McpClientAuthorizationPrincipal } from '#models/mcp-client-authorizations/model.ts';
import { AssetsRepository } from '#repositories/assets/repository.ts';
import {
  AssetTransferCapabilities,
  MCP_ASSET_TRANSFER_CAPABILITY_HEADER,
} from '#routes/mcp/assets/transfer-capabilities.ts';
import { createAssetTransferController } from '#routes/mcp/assets/transfer-controller.ts';
import { createContextUseMcpServer } from '#routes/mcp/server.ts';
import { AssetsService, type AssetsServiceContract } from '#services/assets/service.ts';
import type { EntitiesServiceContract } from '#services/entities/service.ts';
import type { KnowledgePagesServiceContract } from '#services/knowledge-pages/service.ts';
import { expectNoInternalResourceIds } from '../../../support/public-api.ts';

const NOW = '2026-09-01T12:00:00.000Z';
const INTERNAL_CLIENT_AUTHORIZATION_ID = '01900000-0000-7000-8000-000000000003';
const PNG_BYTES = Buffer.from('89504e470d0a1a0a00010203', 'hex');

type TransferRequest = {
  method: 'GET' | 'PUT';
  url: string;
  requiredHeaders: Record<string, string>;
  expiresAt: string;
  instructions: string;
};

type AssetResult = {
  address: string;
  readableId: string;
  name: string;
  mediaType: string;
  extension: string | null;
  sizeBytes: number;
  usages: unknown[];
  download?: TransferRequest | null;
};

function unexpectedCall(): never {
  throw new Error('Unexpected MCP service call');
}

const principal: McpClientAuthorizationPrincipal = {
  ownerId: OWNER_USER_ID,
  clientAuthorizationId: INTERNAL_CLIENT_AUTHORIZATION_ID,
  clientAuthorizationName: 'Research agent',
};

const unusedEntitiesService: EntitiesServiceContract = {
  create: unexpectedCall,
  list: unexpectedCall,
  detail: unexpectedCall,
  update: unexpectedCall,
  setImage: unexpectedCall,
  removeImage: unexpectedCall,
  archive: unexpectedCall,
};

const unusedPagesService: KnowledgePagesServiceContract = {
  create: unexpectedCall,
  list: unexpectedCall,
  detail: unexpectedCall,
  update: unexpectedCall,
  archive: unexpectedCall,
  rebuildIndex: unexpectedCall,
};

async function seedOwner(database: SQL): Promise<void> {
  await database`
    insert into "auth_user"
      ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
    values (${OWNER_USER_ID}, 'Owner', ${OWNER_SYNTHETIC_EMAIL}, 1, ${NOW}, ${NOW})
  `;
}

async function storedFiles({ dataFolder }: { dataFolder: string }): Promise<string[]> {
  return await Array.fromAsync(
    new Bun.Glob('**/*').scan({ cwd: join(dataFolder, 'objects'), onlyFiles: true }),
  );
}

async function assetCount({ database }: { database: SQL }): Promise<number> {
  const rows = await database<Array<{ total: number }>>`
    select count(*) as "total" from "asset" where "owner_id" = ${OWNER_USER_ID}
  `;
  return Number(rows[0]?.total ?? 0);
}

async function withAssetMcp({
  run,
}: {
  run: (input: {
    assetsService: AssetsServiceContract;
    client: Client;
    database: SQL;
    dataFolder: string;
    transferController: ReturnType<typeof createAssetTransferController>;
  }) => Promise<void>;
}): Promise<void> {
  const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-mcp-assets-test-'));
  const database = await createSqliteDatabase({ dataFolder });
  const storage = new LocalStorage(join(dataFolder, 'objects'));
  const assetsService = new AssetsService({
    assets: new AssetsRepository(database),
    storage,
  });
  const transferCapabilities = new AssetTransferCapabilities({
    baseUrl: new URL('https://context-use.example'),
  });
  const transferController = createAssetTransferController({
    assetsService,
    transferCapabilities,
  });
  const server = createContextUseMcpServer({
    principal,
    assetsService,
    entitiesService: unusedEntitiesService,
    pagesService: unusedPagesService,
    transferCapabilities,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'context-use-asset-test', version: '1.0.0' });

  try {
    await runMigrations({ db: database });
    await seedOwner(database);
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await run({ assetsService, client, database, dataFolder, transferController });
  } finally {
    await client.close();
    await server.close();
    await database.close();
    await rm(dataFolder, { recursive: true, force: true });
  }
}

function successfulResult<T>(result: Awaited<ReturnType<Client['callTool']>>): T {
  if (result.isError) {
    throw new Error(JSON.stringify(result.structuredContent));
  }
  return result.structuredContent as T;
}

async function createUpload({
  client,
  name,
  allowDuplicate,
}: {
  client: Client;
  name: string;
  allowDuplicate?: boolean;
}): Promise<TransferRequest> {
  return successfulResult<TransferRequest>(
    await client.callTool({
      name: 'create_asset_upload',
      arguments: { name, allowDuplicate },
    }),
  );
}

async function upload({
  transferController,
  request,
  bytes = PNG_BYTES,
}: {
  transferController: ReturnType<typeof createAssetTransferController>;
  request: TransferRequest;
  bytes?: Uint8Array;
}): Promise<Response> {
  return await transferController.handle(
    new Request(request.url, {
      method: request.method,
      headers: request.requiredHeaders,
      body: bytes,
    }),
  );
}

test('MCP asset uploads defer persistence, preserve AssetsService behavior, and expose paginated CRUD', async () => {
  await withAssetMcp({
    run: async ({ client, database, dataFolder, transferController }) => {
      const uploadRequest = await createUpload({ client, name: 'Quarterly chart' });
      expect(uploadRequest.method).toBe('PUT');
      expect(uploadRequest.url).toMatch(
        /^https:\/\/context-use\.example\/mcp\/asset-transfers\/uploads\/[A-Za-z0-9_-]+$/,
      );
      expect(uploadRequest.requiredHeaders).toEqual({
        'content-type': 'application/octet-stream',
        [MCP_ASSET_TRANSFER_CAPABILITY_HEADER]: expect.any(String),
      });
      expect(uploadRequest.expiresAt).toBeString();
      expect(uploadRequest.instructions).toContain('raw asset bytes');
      expect(JSON.stringify(uploadRequest)).not.toContain('Bearer');
      expect(JSON.stringify(uploadRequest)).not.toContain(OWNER_USER_ID);
      expect(JSON.stringify(uploadRequest)).not.toContain(INTERNAL_CLIENT_AUTHORIZATION_ID);
      expect(await assetCount({ database })).toBe(0);
      expect(await storedFiles({ dataFolder })).toEqual([]);

      const uploadRequestId = new URL(uploadRequest.url).pathname.split('/').at(-1)!;
      const uploadSecret = uploadRequest.requiredHeaders[MCP_ASSET_TRANSFER_CAPABILITY_HEADER]!;
      const uploadResponse = await upload({ transferController, request: uploadRequest });
      expect(uploadResponse.status).toBe(StatusMap.Created);
      const created = (await uploadResponse.json()) as AssetResult;
      expectNoInternalResourceIds(created);
      expect(created).toEqual(
        expect.objectContaining({
          address: 'context-use://asset/quarterly-chart',
          readableId: 'quarterly-chart',
          name: 'Quarterly chart',
          mediaType: 'image/png',
          extension: 'png',
          sizeBytes: PNG_BYTES.byteLength,
          usages: [],
        }),
      );
      expect(JSON.stringify(created)).not.toContain(uploadRequestId);
      expect(JSON.stringify(created)).not.toContain(uploadSecret);
      expect(await assetCount({ database })).toBe(1);
      expect(await storedFiles({ dataFolder })).toHaveLength(1);

      const replay = await upload({ transferController, request: uploadRequest });
      expect(replay.status).toBe(StatusMap['Not Found']);
      expect(await assetCount({ database })).toBe(1);

      const conflictRequest = await createUpload({ client, name: 'Quarterly chart' });
      const conflictResponse = await upload({ transferController, request: conflictRequest });
      expect(conflictResponse.status).toBe(StatusMap.Conflict);
      expect(await conflictResponse.json()).toEqual({
        error: expect.objectContaining({
          code: 'asset_name_conflict',
          allowDuplicateRetryAvailable: true,
        }),
      });
      expect(await assetCount({ database })).toBe(1);
      expect(await storedFiles({ dataFolder })).toHaveLength(1);

      const duplicateRequest = await createUpload({
        client,
        name: 'Quarterly chart',
        allowDuplicate: true,
      });
      const duplicateResponse = await upload({
        transferController,
        request: duplicateRequest,
      });
      expect(duplicateResponse.status).toBe(StatusMap.Created);
      const duplicate = (await duplicateResponse.json()) as AssetResult;
      expect(duplicate.readableId).not.toBe(created.readableId);
      expect(duplicate.name).toBe(created.name);
      expect(await assetCount({ database })).toBe(2);
      expect(await storedFiles({ dataFolder })).toHaveLength(2);

      const firstPage = successfulResult<{
        items: AssetResult[];
        total: number;
        nextCursor: string;
      }>(await client.callTool({ name: 'list_assets', arguments: { limit: 1 } }));
      expect(firstPage.total).toBe(2);
      expect(firstPage.items).toHaveLength(1);
      expect(firstPage.nextCursor).not.toBe('1');
      expectNoInternalResourceIds(firstPage);
      const secondPage = successfulResult<{
        items: AssetResult[];
        total: number;
        nextCursor: null;
      }>(
        await client.callTool({
          name: 'list_assets',
          arguments: { limit: 1, cursor: firstPage.nextCursor },
        }),
      );
      expect(secondPage.items).toHaveLength(1);
      expect(secondPage.nextCursor).toBeNull();
      expect(
        new Set([...firstPage.items, ...secondPage.items].map(({ address }) => address)),
      ).toEqual(new Set([created.address, duplicate.address]));

      const metadata = successfulResult<AssetResult>(
        await client.callTool({
          name: 'read_asset',
          arguments: { address: created.address },
        }),
      );
      expect(metadata.download).toBeNull();
      expectNoInternalResourceIds(metadata);

      const updated = successfulResult<AssetResult>(
        await client.callTool({
          name: 'update_asset',
          arguments: { address: created.address, name: 'Q3 evidence chart' },
        }),
      );
      expect(updated).toEqual(
        expect.objectContaining({
          address: created.address,
          readableId: created.readableId,
          name: 'Q3 evidence chart',
        }),
      );

      const withDownload = successfulResult<AssetResult>(
        await client.callTool({
          name: 'read_asset',
          arguments: { address: created.address, includeDownload: true },
        }),
      );
      const downloadRequest = withDownload.download!;
      expect(downloadRequest.method).toBe('GET');
      expect(downloadRequest.requiredHeaders).toEqual({
        [MCP_ASSET_TRANSFER_CAPABILITY_HEADER]: expect.any(String),
      });
      expect(downloadRequest.instructions).toContain('raw asset bytes');
      const downloadResponse = await transferController.handle(
        new Request(downloadRequest.url, {
          method: downloadRequest.method,
          headers: downloadRequest.requiredHeaders,
        }),
      );
      expect(downloadResponse.status).toBe(StatusMap.OK);
      expect(downloadResponse.headers.get('content-type')).toBe('image/png');
      expect(downloadResponse.headers.get('content-disposition')).toStartWith('attachment;');
      expect(new Uint8Array(await downloadResponse.arrayBuffer())).toEqual(PNG_BYTES);
      expect(
        (
          await transferController.handle(
            new Request(downloadRequest.url, {
              method: downloadRequest.method,
              headers: downloadRequest.requiredHeaders,
            }),
          )
        ).status,
      ).toBe(StatusMap['Not Found']);

      const beforeArchive = successfulResult<AssetResult>(
        await client.callTool({
          name: 'read_asset',
          arguments: { address: created.address, includeDownload: true },
        }),
      );
      const archived = successfulResult<{ archived: true; address: string }>(
        await client.callTool({
          name: 'archive_asset',
          arguments: { address: created.address },
        }),
      );
      expect(archived).toEqual({ archived: true, address: created.address });
      expect(
        (
          await transferController.handle(
            new Request(beforeArchive.download!.url, {
              method: 'GET',
              headers: beforeArchive.download!.requiredHeaders,
            }),
          )
        ).status,
      ).toBe(StatusMap['Not Found']);
      expect(await storedFiles({ dataFolder })).toHaveLength(2);
      const archivedRead = await client.callTool({
        name: 'read_asset',
        arguments: { address: created.address },
      });
      expect(archivedRead.isError).toBe(true);
      expect(archivedRead.structuredContent).toEqual({
        error: expect.objectContaining({ code: 'not_found' }),
      });
    },
  });
});

test('raw upload endpoints enforce required headers and byte limits before one AssetsService call', async () => {
  const createdAsset: Asset = {
    id: 'internal-asset-id',
    readableId: 'bounded-upload',
    name: 'Bounded upload',
    mediaType: 'application/octet-stream',
    extension: null,
    sizeBytes: PNG_BYTES.byteLength,
    usages: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
  let createCalls = 0;
  const assetsService: AssetsServiceContract = {
    create: async (input) => {
      createCalls += 1;
      expect(input).toEqual(
        expect.objectContaining({
          ownerId: principal.ownerId,
          name: createdAsset.name,
          allowDuplicate: true,
        }),
      );
      expect(new Uint8Array(await input.file.arrayBuffer())).toEqual(PNG_BYTES);
      return { state: 'created', asset: createdAsset };
    },
    list: unexpectedCall,
    detail: unexpectedCall,
    updateName: unexpectedCall,
    archive: unexpectedCall,
    content: unexpectedCall,
  };
  const capabilities = new AssetTransferCapabilities({
    baseUrl: new URL('https://context-use.example'),
  });
  const controller = createAssetTransferController({
    assetsService,
    transferCapabilities: capabilities,
  });

  const missingSecret = capabilities.issueUpload({ principal, name: 'Missing secret' });
  expect(
    (
      await controller.handle(
        new Request(missingSecret.url, {
          method: 'PUT',
          headers: { 'content-type': 'application/octet-stream' },
          body: PNG_BYTES,
        }),
      )
    ).status,
  ).toBe(StatusMap['Not Found']);
  expect(
    (
      await controller.handle(
        new Request(missingSecret.url, {
          method: 'PUT',
          headers: {
            'content-type': 'application/octet-stream',
            [MCP_ASSET_TRANSFER_CAPABILITY_HEADER]: missingSecret.secret,
          },
          body: PNG_BYTES,
        }),
      )
    ).status,
  ).toBe(StatusMap['Not Found']);
  expect(createCalls).toBe(0);

  const oversized = capabilities.issueUpload({ principal, name: 'Too large' });
  const oversizedResponse = await controller.handle(
    new Request(oversized.url, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        [MCP_ASSET_TRANSFER_CAPABILITY_HEADER]: oversized.secret,
      },
      body: new Uint8Array(MAX_ASSET_BYTES + 1),
    }),
  );
  expect(oversizedResponse.status).toBe(StatusMap['Payload Too Large']);
  expect(createCalls).toBe(0);
  expect(
    (
      await controller.handle(
        new Request(oversized.url, {
          method: 'PUT',
          headers: {
            'content-type': 'application/octet-stream',
            [MCP_ASSET_TRANSFER_CAPABILITY_HEADER]: oversized.secret,
          },
          body: PNG_BYTES,
        }),
      )
    ).status,
  ).toBe(StatusMap['Not Found']);

  const wrongMediaType = capabilities.issueUpload({ principal, name: 'Wrong media type' });
  expect(
    (
      await controller.handle(
        new Request(wrongMediaType.url, {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            [MCP_ASSET_TRANSFER_CAPABILITY_HEADER]: wrongMediaType.secret,
          },
          body: PNG_BYTES,
        }),
      )
    ).status,
  ).toBe(StatusMap['Unsupported Media Type']);
  expect(createCalls).toBe(0);

  const accepted = capabilities.issueUpload({
    principal,
    name: createdAsset.name,
    allowDuplicate: true,
  });
  const acceptedCapability = new URL(accepted.url).pathname.split('/').at(-1)!;
  const acceptedResponse = await controller.handle(
    new Request(accepted.url, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        [MCP_ASSET_TRANSFER_CAPABILITY_HEADER]: accepted.secret,
      },
      body: PNG_BYTES,
    }),
  );
  expect(acceptedResponse.status).toBe(StatusMap.Created);
  expect(createCalls).toBe(1);
  const acceptedBody = await acceptedResponse.text();
  expectNoInternalResourceIds(JSON.parse(acceptedBody));
  expect(acceptedBody).not.toContain(acceptedCapability);
  expect(acceptedBody).not.toContain(accepted.secret);
});

test('asset updates preserve the address and archive blockers expose only public usage coordinates', async () => {
  const asset: Asset = {
    id: 'internal-asset-id',
    readableId: 'quarterly-chart',
    name: 'Quarterly chart',
    mediaType: 'image/png',
    extension: 'png',
    sizeBytes: PNG_BYTES.byteLength,
    createdAt: NOW,
    updatedAt: NOW,
    usages: [
      {
        kind: 'page',
        page: {
          id: 'internal-page-id',
          readableId: 'evidence-report',
          title: 'Evidence report',
          excerpt: 'Quarterly evidence.',
          revisionNumber: 1,
          createdAt: NOW,
          updatedAt: NOW,
        },
        presentation: 'embed',
      },
      {
        kind: 'entity_image',
        entity: {
          id: 'internal-entity-id',
          readableId: 'luca-bianchi',
          name: 'Luca Bianchi',
          description: 'Researcher and collaborator',
          isSelf: false,
        },
      },
    ],
  };
  let archiveCalls = 0;
  const assetsService: AssetsServiceContract = {
    create: unexpectedCall,
    list: unexpectedCall,
    detail: unexpectedCall,
    updateName: (input) => {
      expect(input).toEqual({
        ownerId: principal.ownerId,
        readableId: asset.readableId,
        name: 'Q3 evidence chart',
      });
      return Promise.resolve({ ...asset, name: input.name });
    },
    archive: (input) => {
      archiveCalls += 1;
      expect(input).toEqual({ ownerId: principal.ownerId, readableId: asset.readableId });
      return Promise.resolve({ state: 'resource_in_use', blockers: asset.usages });
    },
    content: unexpectedCall,
  };
  const transferCapabilities = new AssetTransferCapabilities({
    baseUrl: new URL('https://context-use.example'),
  });
  const server = createContextUseMcpServer({
    principal,
    assetsService,
    entitiesService: unusedEntitiesService,
    pagesService: unusedPagesService,
    transferCapabilities,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'context-use-asset-test', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const updated = successfulResult<AssetResult>(
      await client.callTool({
        name: 'update_asset',
        arguments: {
          address: 'context-use://asset/quarterly-chart',
          name: 'Q3 evidence chart',
        },
      }),
    );
    expect(updated).toEqual(
      expect.objectContaining({
        address: 'context-use://asset/quarterly-chart',
        readableId: 'quarterly-chart',
        name: 'Q3 evidence chart',
      }),
    );
    expectNoInternalResourceIds(updated);

    const blocked = await client.callTool({
      name: 'archive_asset',
      arguments: { address: 'context-use://asset/quarterly-chart' },
    });
    expect(blocked.isError).toBe(true);
    expect(blocked.structuredContent).toEqual({
      error: expect.objectContaining({
        code: 'resource_in_use',
        blockers: [
          expect.objectContaining({
            kind: 'page',
            page: expect.objectContaining({
              address: 'context-use://page/evidence-report',
              readableId: 'evidence-report',
            }),
          }),
          expect.objectContaining({
            kind: 'entity_image',
            entity: expect.objectContaining({
              address: 'context-use://entity/luca-bianchi',
              readableId: 'luca-bianchi',
            }),
          }),
        ],
      }),
    });
    expectNoInternalResourceIds(blocked.structuredContent);
    expect(archiveCalls).toBe(1);
  } finally {
    await client.close();
    await server.close();
  }
});
