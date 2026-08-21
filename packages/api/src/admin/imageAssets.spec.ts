import { Types } from 'mongoose';
import type { AdminImageAsset, IMongoFile, IUser } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { AdminImageAssetsDeps } from './imageAssets';
import { createAdminImageAssetsHandlers } from './imageAssets';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const userId = new Types.ObjectId();
const fileId = 'image-file-1';

function createReqRes(query: Record<string, string> = {}, params: Record<string, string> = {}) {
  const req = { query, params } as unknown as ServerRequest;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { req, res: { status } as unknown as Response, status, json };
}

function imageFile(overrides: Partial<IMongoFile> = {}): IMongoFile {
  return {
    _id: new Types.ObjectId(),
    user: userId,
    file_id: fileId,
    filename: 'generated.png',
    filepath: `/images/${userId.toString()}/generated.png`,
    bytes: 1024,
    object: 'file',
    type: 'image/png',
    usage: 1,
    source: 'local',
    context: 'image_generation',
    createdAt: new Date('2026-07-15T10:00:00.000Z'),
    updatedAt: new Date('2026-07-15T10:00:01.000Z'),
    ...overrides,
  } as IMongoFile;
}

function createDeps(overrides: Partial<AdminImageAssetsDeps> = {}): AdminImageAssetsDeps {
  return {
    listImageAssets: jest.fn().mockResolvedValue({ files: [imageFile()], nextCursor: 'next-page' }),
    countImageAssets: jest.fn().mockResolvedValue(1),
    findUsers: jest
      .fn()
      .mockResolvedValue([
        { _id: userId, name: 'Image User', email: 'image@example.com' } as IUser,
      ]),
    findFileById: jest.fn().mockResolvedValue(imageFile()),
    deleteImageAsset: jest.fn().mockResolvedValue({ deletedFileIds: [fileId], failedFileIds: [] }),
    ...overrides,
  };
}

describe('createAdminImageAssetsHandlers', () => {
  it('lists generated image assets with member identity and pagination', async () => {
    const deps = createDeps();
    const handlers = createAdminImageAssetsHandlers(deps);
    const { req, res, status, json } = createReqRes({
      userId: userId.toString(),
      limit: '500',
    });

    await handlers.listImageAssets(req, res);

    expect(deps.listImageAssets).toHaveBeenCalledWith({
      userId: userId.toString(),
      cursor: null,
      limit: 100,
    });
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      assets: [
        expect.objectContaining<Partial<AdminImageAsset>>({
          id: fileId,
          filename: 'generated.png',
          user: {
            id: userId.toString(),
            name: 'Image User',
            email: 'image@example.com',
          },
        }),
      ],
      nextCursor: 'next-page',
      total: 1,
    });
  });

  it('rejects malformed member and cursor filters', async () => {
    const deps = createDeps();
    const handlers = createAdminImageAssetsHandlers(deps);

    for (const query of [{ userId: 'not-an-id' }, { cursor: 'not-a-cursor' }]) {
      const { req, res, status } = createReqRes(query);
      await handlers.listImageAssets(req, res);
      expect(status).toHaveBeenCalledWith(400);
    }

    expect(deps.listImageAssets).not.toHaveBeenCalled();
  });

  it('rejects non-image assets and deletes a valid asset', async () => {
    const deps = createDeps();
    const handlers = createAdminImageAssetsHandlers(deps);
    const { req, res, status, json } = createReqRes({}, { fileId });

    await handlers.deleteImageAsset(req, res);

    expect(deps.deleteImageAsset).toHaveBeenCalledWith(
      req,
      expect.objectContaining({ file_id: fileId }),
    );
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ fileId, deleted: true });

    const nonImageDeps = createDeps({
      findFileById: jest.fn().mockResolvedValue(imageFile({ type: 'text/plain' })),
    });
    const nonImageHandlers = createAdminImageAssetsHandlers(nonImageDeps);
    const nonImage = createReqRes({}, { fileId });
    await nonImageHandlers.deleteImageAsset(nonImage.req, nonImage.res);
    expect(nonImage.status).toHaveBeenCalledWith(404);
    expect(nonImageDeps.deleteImageAsset).not.toHaveBeenCalled();
  });

  it('returns an error when storage deletion fails', async () => {
    const deps = createDeps({
      deleteImageAsset: jest
        .fn()
        .mockResolvedValue({ deletedFileIds: [], failedFileIds: [fileId] }),
    });
    const handlers = createAdminImageAssetsHandlers(deps);
    const { req, res, status } = createReqRes({}, { fileId });

    await handlers.deleteImageAsset(req, res);

    expect(status).toHaveBeenCalledWith(500);
  });

  it('does not report success without a confirmed metadata deletion', async () => {
    const deps = createDeps({
      deleteImageAsset: jest.fn().mockResolvedValue({ deletedFileIds: [], failedFileIds: [] }),
    });
    const handlers = createAdminImageAssetsHandlers(deps);
    const { req, res, status } = createReqRes({}, { fileId });

    await handlers.deleteImageAsset(req, res);

    expect(status).toHaveBeenCalledWith(500);
  });
});
