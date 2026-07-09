import { Types } from 'mongoose';
import type { IUser, IMessage, IConversation } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { AdminConversationsDeps } from './conversations';
import { createAdminConversationsHandlers } from './conversations';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const validUserId = new Types.ObjectId().toString();
const conversationId = 'abc-123_XYZ';

function mockUser(): IUser {
  return { _id: new Types.ObjectId(validUserId) } as IUser;
}

function mockConvo(overrides: Partial<IConversation> = {}): IConversation {
  return {
    conversationId,
    title: 'Quarterly report',
    endpoint: 'openAI',
    model: 'gpt-5.5',
    messages: [new Types.ObjectId(), new Types.ObjectId()],
    isArchived: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-06-01'),
    ...overrides,
  } as IConversation;
}

function mockMessage(overrides: Partial<IMessage> = {}): IMessage {
  return {
    messageId: 'm1',
    conversationId,
    user: validUserId,
    sender: 'User',
    text: 'hello',
    isCreatedByUser: true,
    error: false,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  } as IMessage;
}

function createReqRes(
  overrides: { params?: Record<string, string>; query?: Record<string, string> } = {},
) {
  const req = {
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    body: {},
    user: { _id: new Types.ObjectId(), role: 'admin' },
  } as unknown as ServerRequest;

  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;

  return { req, res, status, json };
}

function createDeps(overrides: Partial<AdminConversationsDeps> = {}): AdminConversationsDeps {
  return {
    findUsers: jest.fn().mockResolvedValue([mockUser()]),
    getConvosByCursor: jest.fn().mockResolvedValue({ conversations: [], nextCursor: null }),
    countConversations: jest.fn().mockResolvedValue(0),
    getConvo: jest.fn().mockResolvedValue(mockConvo()),
    deleteConvos: jest.fn().mockResolvedValue({ deletedCount: 1, messages: { deletedCount: 5 } }),
    getMessages: jest.fn().mockResolvedValue([]),
    countMessages: jest.fn().mockResolvedValue(0),
    ...overrides,
  };
}

describe('createAdminConversationsHandlers', () => {
  describe('listConversations', () => {
    it('returns the mapped conversations with a total and cursor', async () => {
      const deps = createDeps({
        getConvosByCursor: jest
          .fn()
          .mockResolvedValue({ conversations: [mockConvo()], nextCursor: 'next-page' }),
        countConversations: jest.fn().mockResolvedValue(7),
        getMessages: jest.fn().mockResolvedValue([mockMessage(), mockMessage({ messageId: 'm2' })]),
      });
      const handlers = createAdminConversationsHandlers(deps);
      const { req, res, status, json } = createReqRes({ params: { userId: validUserId } });

      await handlers.listConversations(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({
        conversations: [
          expect.objectContaining({ conversationId, title: 'Quarterly report', messageCount: 2 }),
        ],
        nextCursor: 'next-page',
        total: 7,
      });
    });

    it('tallies message counts with one query, not one per conversation', async () => {
      const other = mockConvo({ conversationId: 'second-convo' });
      const deps = createDeps({
        getConvosByCursor: jest
          .fn()
          .mockResolvedValue({ conversations: [mockConvo(), other], nextCursor: null }),
        getMessages: jest
          .fn()
          .mockResolvedValue([
            mockMessage(),
            mockMessage({ messageId: 'm2' }),
            mockMessage({ messageId: 'm3', conversationId: 'second-convo' }),
          ]),
      });
      const handlers = createAdminConversationsHandlers(deps);
      const { req, res, json } = createReqRes({ params: { userId: validUserId } });

      await handlers.listConversations(req, res);

      expect(deps.getMessages).toHaveBeenCalledTimes(1);
      expect(deps.getMessages).toHaveBeenCalledWith(
        { conversationId: { $in: [conversationId, 'second-convo'] }, user: validUserId },
        'conversationId',
      );
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          conversations: [
            expect.objectContaining({ conversationId, messageCount: 2 }),
            expect.objectContaining({ conversationId: 'second-convo', messageCount: 1 }),
          ],
        }),
      );
    });

    it('skips the message query when the user has no conversations', async () => {
      const deps = createDeps();
      const handlers = createAdminConversationsHandlers(deps);
      const { req, res } = createReqRes({ params: { userId: validUserId } });

      await handlers.listConversations(req, res);

      expect(deps.getMessages).not.toHaveBeenCalled();
    });

    it('forwards the cursor and clamps an oversized limit', async () => {
      const deps = createDeps();
      const handlers = createAdminConversationsHandlers(deps);
      const { req, res } = createReqRes({
        params: { userId: validUserId },
        query: { cursor: 'c1', limit: '5000' },
      });

      await handlers.listConversations(req, res);

      expect(deps.getConvosByCursor).toHaveBeenCalledWith(validUserId, {
        cursor: 'c1',
        limit: 100,
      });
    });

    it('returns 400 for an invalid user id', async () => {
      const handlers = createAdminConversationsHandlers(createDeps());
      const { req, res, status, json } = createReqRes({ params: { userId: 'bad' } });

      await handlers.listConversations(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Invalid user ID format' });
    });

    it('returns 404 when the user does not exist', async () => {
      const deps = createDeps({ findUsers: jest.fn().mockResolvedValue([]) });
      const handlers = createAdminConversationsHandlers(deps);
      const { req, res, status, json } = createReqRes({ params: { userId: validUserId } });

      await handlers.listConversations(req, res);

      expect(status).toHaveBeenCalledWith(404);
      expect(json).toHaveBeenCalledWith({ error: 'User not found' });
    });

    it('returns 500 when the data layer throws', async () => {
      const deps = createDeps({
        getConvosByCursor: jest.fn().mockRejectedValue(new Error('db crash')),
      });
      const handlers = createAdminConversationsHandlers(deps);
      const { req, res, status, json } = createReqRes({ params: { userId: validUserId } });

      await handlers.listConversations(req, res);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({ error: 'Failed to list conversations' });
    });
  });

  describe('getConversationMessages', () => {
    it('returns the conversation with its messages', async () => {
      const deps = createDeps({
        getMessages: jest.fn().mockResolvedValue([mockMessage(), mockMessage({ messageId: 'm2' })]),
      });
      const handlers = createAdminConversationsHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { userId: validUserId, conversationId },
      });

      await handlers.getConversationMessages(req, res);

      expect(deps.getMessages).toHaveBeenCalledWith({ conversationId, user: validUserId });
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({
        conversation: expect.objectContaining({ conversationId, messageCount: 2 }),
        messages: [
          expect.objectContaining({ messageId: 'm1', text: 'hello', isCreatedByUser: true }),
          expect.objectContaining({ messageId: 'm2' }),
        ],
      });
    });

    it('rejects a malformed conversation id', async () => {
      const handlers = createAdminConversationsHandlers(createDeps());
      const { req, res, status, json } = createReqRes({
        params: { userId: validUserId, conversationId: 'bad/../id' },
      });

      await handlers.getConversationMessages(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Invalid conversation ID format' });
    });

    it('returns 404 when the conversation does not belong to the user', async () => {
      const deps = createDeps({ getConvo: jest.fn().mockResolvedValue(null) });
      const handlers = createAdminConversationsHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { userId: validUserId, conversationId },
      });

      await handlers.getConversationMessages(req, res);

      expect(status).toHaveBeenCalledWith(404);
      expect(json).toHaveBeenCalledWith({ error: 'Conversation not found' });
    });
  });

  describe('deleteConversation', () => {
    it('deletes the conversation and reports the message count', async () => {
      const deps = createDeps();
      const handlers = createAdminConversationsHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { userId: validUserId, conversationId },
      });

      await handlers.deleteConversation(req, res);

      expect(deps.deleteConvos).toHaveBeenCalledWith(validUserId, { conversationId });
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ deletedCount: 1, messagesDeleted: 5 });
    });

    it('does not delete when the conversation belongs to another user', async () => {
      const deps = createDeps({ getConvo: jest.fn().mockResolvedValue(null) });
      const handlers = createAdminConversationsHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { userId: validUserId, conversationId },
      });

      await handlers.deleteConversation(req, res);

      expect(deps.deleteConvos).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(404);
      expect(json).toHaveBeenCalledWith({ error: 'Conversation not found' });
    });
  });

  describe('getUserAssetStats', () => {
    it('returns conversation and message counters with last activity', async () => {
      const deps = createDeps({
        countConversations: jest.fn().mockResolvedValue(4),
        countMessages: jest.fn().mockResolvedValue(12),
        getConvosByCursor: jest
          .fn()
          .mockResolvedValue({ conversations: [mockConvo()], nextCursor: null }),
      });
      const handlers = createAdminConversationsHandlers(deps);
      const { req, res, status, json } = createReqRes({ params: { userId: validUserId } });

      await handlers.getUserAssetStats(req, res);

      expect(deps.countMessages).toHaveBeenCalledWith({ user: validUserId });
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({
        conversationCount: 4,
        messageCount: 12,
        lastActiveAt: new Date('2026-06-01').toISOString(),
      });
    });

    it('omits last activity when the user has no conversations', async () => {
      const handlers = createAdminConversationsHandlers(createDeps());
      const { req, res, json } = createReqRes({ params: { userId: validUserId } });

      await handlers.getUserAssetStats(req, res);

      expect(json).toHaveBeenCalledWith({
        conversationCount: 0,
        messageCount: 0,
        lastActiveAt: undefined,
      });
    });
  });
});
