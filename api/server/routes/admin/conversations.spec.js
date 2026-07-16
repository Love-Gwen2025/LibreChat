const express = require('express');
const request = require('supertest');

const validUserId = '507f1f77bcf86cd799439011';
const conversationId = '8b94f5c2-a884-4daf-93b6-5b88cbefad2b';
const fileId = 'generated-image-1';

const mockRequireJwtAuth = jest.fn((req, _res, next) => {
  req.user = { id: 'admin-1', role: 'ADMIN' };
  next();
});
const mockConfigMiddleware = jest.fn((req, _res, next) => {
  req.config = { paths: { imageOutput: '/private/images', uploads: '/private/uploads' } };
  next();
});
const mockCapabilityMiddleware = jest.fn((_req, _res, next) => next());
const mockRequireCapability = jest.fn(() => mockCapabilityMiddleware);
const mockStreamStoredFile = jest.fn(async ({ res }) => res.status(200).end());
const mockHandlers = {
  getUserAssetStats: jest.fn((_req, res) => res.status(200).json({})),
  listConversations: jest.fn((_req, res) => res.status(200).json({ conversations: [] })),
  getConversationMessages: jest.fn((_req, res) => res.status(200).json({ messages: [] })),
  deleteConversation: jest.fn((_req, res) => res.status(200).json({ deletedCount: 1 })),
};
const mockDb = {
  findUsers: jest.fn(),
  getConvosByCursor: jest.fn(),
  countConversations: jest.fn(),
  getConvo: jest.fn(),
  deleteConvos: jest.fn(),
  getMessages: jest.fn(),
  getMessagesByCursor: jest.fn(),
  countMessages: jest.fn(),
  findFileById: jest.fn(),
};

jest.mock('@librechat/api', () => ({
  createAdminConversationsHandlers: jest.fn(() => mockHandlers),
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn() },
  isValidObjectIdString: (value) => /^[a-f\d]{24}$/i.test(value),
  SystemCapabilities: {
    ACCESS_ADMIN: 'access:admin',
    READ_USERS: 'read:users',
    MANAGE_USERS: 'manage:users',
  },
}));

jest.mock('~/server/middleware/roles/capabilities', () => ({
  requireCapability: mockRequireCapability,
}));

jest.mock('~/server/middleware', () => ({
  configMiddleware: mockConfigMiddleware,
  requireJwtAuth: mockRequireJwtAuth,
}));

jest.mock('~/server/services/Files/streamStoredFile', () => ({
  streamStoredFile: mockStreamStoredFile,
}));

jest.mock('~/models', () => mockDb);

function createApp() {
  delete require.cache[require.resolve('./conversations')];
  const router = require('./conversations');
  const app = express();
  app.use('/api/admin/conversations', router);
  return app;
}

function imageUrl() {
  return `/api/admin/conversations/${validUserId}/${conversationId}/images/${fileId}`;
}

describe('admin conversation image route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.getConvo.mockResolvedValue({ conversationId, user: validUserId });
    mockDb.findFileById.mockResolvedValue({
      file_id: fileId,
      user: validUserId,
      filename: 'result.png',
      filepath: '/private/result.png',
      source: 'local',
      type: 'image/png',
      bytes: 128,
    });
    mockDb.getMessages.mockResolvedValue([{ _id: 'message-1' }]);
  });

  it('streams only an owned image referenced by the requested conversation', async () => {
    const app = createApp();

    await request(app).get(imageUrl()).expect(200);

    expect(mockConfigMiddleware).toHaveBeenCalledTimes(1);
    expect(mockDb.getConvo).toHaveBeenCalledWith(validUserId, conversationId);
    expect(mockDb.findFileById).toHaveBeenCalledWith(fileId, { user: validUserId });
    expect(mockDb.getMessages).toHaveBeenCalledWith(
      {
        user: validUserId,
        conversationId,
        $or: [{ 'files.file_id': fileId }, { 'attachments.file_id': fileId }],
      },
      '_id',
      { limit: 1, sort: false },
    );
    expect(mockStreamStoredFile).toHaveBeenCalledWith(
      expect.objectContaining({
        disposition: 'inline',
        contentType: 'image/png',
        file: expect.objectContaining({ file_id: fileId }),
      }),
    );
  });

  it('returns not found when the conversation or owned file is missing', async () => {
    const app = createApp();
    mockDb.getConvo.mockResolvedValueOnce(null);

    await request(app).get(imageUrl()).expect(404);
    expect(mockStreamStoredFile).not.toHaveBeenCalled();

    mockDb.getConvo.mockResolvedValueOnce({ conversationId, user: validUserId });
    mockDb.findFileById.mockResolvedValueOnce(null);
    await request(app).get(imageUrl()).expect(404);
    expect(mockStreamStoredFile).not.toHaveBeenCalled();
  });

  it('rejects files that are not referenced by a message in the conversation', async () => {
    const app = createApp();
    mockDb.getMessages.mockResolvedValue([]);

    await request(app).get(imageUrl()).expect(404);

    expect(mockStreamStoredFile).not.toHaveBeenCalled();
  });

  it('rejects non-image files before opening storage', async () => {
    const app = createApp();
    mockDb.findFileById.mockResolvedValue({
      file_id: fileId,
      user: validUserId,
      filename: 'secret.txt',
      source: 'local',
      type: 'text/plain',
      bytes: 128,
    });

    await request(app).get(imageUrl()).expect(415);

    expect(mockDb.getMessages).not.toHaveBeenCalled();
    expect(mockStreamStoredFile).not.toHaveBeenCalled();
  });
});
