const express = require('express');
const request = require('supertest');

const fileId = 'generated-image-1';
const userId = '507f1f77bcf86cd799439011';

const mockRequireJwtAuth = jest.fn((req, _res, next) => {
  req.user = { id: 'admin-1' };
  next();
});
const mockConfigMiddleware = jest.fn((req, _res, next) => {
  req.config = { paths: { imageOutput: '/private/images', uploads: '/private/uploads' } };
  next();
});
const mockCapabilityMiddleware = jest.fn((_req, _res, next) => next());
const mockRequireCapability = jest.fn(() => mockCapabilityMiddleware);
const mockStreamAdminImageAsset = jest.fn(async ({ res }) => res.status(200).end());
const mockDeleteAdminImageAsset = jest.fn();
const mockHandlers = {
  listImageAssets: jest.fn((_req, res) => res.status(200).json({ assets: [], total: 0 })),
  deleteImageAsset: jest.fn((_req, res) => res.status(200).json({ deleted: true })),
};
const mockDb = {
  listImageAssets: jest.fn(),
  countImageAssets: jest.fn(),
  findUsers: jest.fn(),
  findFileById: jest.fn(),
};

jest.mock('@librechat/api', () => ({
  createAdminImageAssetsHandlers: jest.fn(() => mockHandlers),
  isImageAsset: jest.fn((file) => file?.context === 'image_generation'),
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn() },
  SystemCapabilities: {
    ACCESS_ADMIN: 'access:admin',
    READ_USERS: 'read:users',
    MANAGE_USERS: 'manage:users',
  },
}));

jest.mock('mime', () => ({ getType: jest.fn(() => 'image/png') }));

jest.mock('~/server/middleware/roles/capabilities', () => ({
  requireCapability: mockRequireCapability,
}));

jest.mock('~/server/middleware', () => ({
  configMiddleware: mockConfigMiddleware,
  requireJwtAuth: mockRequireJwtAuth,
}));

jest.mock('~/server/services/Files/admin', () => ({
  deleteAdminImageAsset: mockDeleteAdminImageAsset,
  streamAdminImageAsset: mockStreamAdminImageAsset,
}));

jest.mock('~/models', () => mockDb);

function createApp() {
  delete require.cache[require.resolve('./imageAssets')];
  const router = require('./imageAssets');
  const app = express();
  app.use('/api/admin/image-assets', router);
  return app;
}

function generatedFile(overrides = {}) {
  return {
    file_id: fileId,
    user: userId,
    filename: 'generated.png',
    filepath: `/images/${userId}/generated.png`,
    source: 'local',
    type: 'image/png',
    context: 'image_generation',
    bytes: 128,
    ...overrides,
  };
}

describe('admin image asset routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.findFileById.mockResolvedValue(generatedFile());
    mockDeleteAdminImageAsset.mockResolvedValue({ deletedFileIds: [fileId], failedFileIds: [] });
  });

  it('requires the admin capability chain and delegates listing', async () => {
    const app = createApp();

    await request(app).get('/api/admin/image-assets').expect(200);

    expect(mockRequireJwtAuth).toHaveBeenCalled();
    expect(mockRequireCapability).toHaveBeenCalledWith('access:admin');
    expect(mockRequireCapability).toHaveBeenCalledWith('read:users');
    expect(mockRequireCapability).toHaveBeenCalledWith('manage:users');
    expect(mockHandlers.listImageAssets).toHaveBeenCalled();
  });

  it('previews only generated images', async () => {
    const app = createApp();

    await request(app).get(`/api/admin/image-assets/${fileId}/preview`).expect(200);
    expect(mockConfigMiddleware).toHaveBeenCalled();
    expect(mockStreamAdminImageAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.objectContaining({ file_id: fileId }),
        contentType: 'image/png',
      }),
    );

    mockDb.findFileById.mockResolvedValueOnce(generatedFile({ context: 'message_attachment' }));
    await request(app).get(`/api/admin/image-assets/${fileId}/preview`).expect(404);
    expect(mockStreamAdminImageAsset).toHaveBeenCalledTimes(1);

    mockDb.findFileById.mockResolvedValueOnce(generatedFile({ type: 'image/svg+xml' }));
    await request(app).get(`/api/admin/image-assets/${fileId}/preview`).expect(415);
    expect(mockStreamAdminImageAsset).toHaveBeenCalledTimes(1);
  });

  it('delegates permanent deletion to the storage-aware handler', async () => {
    const app = createApp();

    await request(app).delete(`/api/admin/image-assets/${fileId}`).expect(200);

    expect(mockConfigMiddleware).toHaveBeenCalled();
    expect(mockHandlers.deleteImageAsset).toHaveBeenCalled();
  });
});
