import { describe, expect, it, mock } from 'bun:test';
import type { StorageClient } from '#lib/storage/storage.ts';
import type { FileRecord, FilesRepository } from '#repositories/files.repository.ts';
import { FilesService } from '#services/files.service.ts';

describe('FilesService', () => {
  it('uses UUIDv7 file IDs', async () => {
    const create = mock((_record: FileRecord) => Promise.resolve());
    const filesRepo = { create } as unknown as FilesRepository;
    const storage: StorageClient = {
      write: mock(() => Promise.resolve(0)),
      file: mock(() => new Blob()),
      exists: mock(() => Promise.resolve(true)),
      size: mock(() => Promise.resolve(0)),
      delete: mock(() => Promise.resolve()),
    };
    const service = new FilesService({ filesRepo, storage });

    const record = await service.upload({
      userId: 'user-id',
      file: new File(['contents'], 'file.txt', { type: 'text/plain' }),
    });

    expect(record.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(create).toHaveBeenCalledWith(record);
  });
});
