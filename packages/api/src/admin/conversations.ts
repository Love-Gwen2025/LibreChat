import { logger, isValidObjectIdString } from '@librechat/data-schemas';
import type {
  IUser,
  IMessage,
  IConversation,
  AdminUserAssetStats,
  AdminConversationMessage,
  AdminConversationListItem,
} from '@librechat/data-schemas';
import type { FilterQuery, DeleteResult } from 'mongoose';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';

const MAX_CONVERSATION_LIMIT = 100;
const DEFAULT_CONVERSATION_LIMIT = 25;

/** Conversation ids are client-generated UUIDs, not ObjectIds. */
const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

interface UserIdParams {
  userId: string;
}

interface ConversationParams extends UserIdParams {
  conversationId: string;
}

export interface AdminConversationsDeps {
  findUsers: (
    searchCriteria: FilterQuery<IUser>,
    fieldsToSelect?: string | string[] | null,
    options?: { limit?: number; offset?: number; sort?: Record<string, 1 | -1> },
  ) => Promise<IUser[]>;
  getConvosByCursor: (
    user: string,
    options?: {
      cursor?: string | null;
      limit?: number;
      isArchived?: boolean | null;
      updatedAfter?: Date;
      updatedBefore?: Date;
    },
  ) => Promise<{ conversations: IConversation[]; nextCursor: string | null }>;
  countConversations: (filter: FilterQuery<IConversation>) => Promise<number>;
  getConvo: (user: string, conversationId: string) => Promise<IConversation | null>;
  deleteConvos: (
    user: string,
    filter: FilterQuery<IConversation>,
  ) => Promise<DeleteResult & { messages: DeleteResult }>;
  getMessages: (
    filter: FilterQuery<IMessage>,
    fieldsToSelect?: string | null,
    options?: { limit?: number; sort?: Record<string, 1 | -1> | false },
  ) => Promise<IMessage[]>;
  getMessagesByCursor: (
    filter: FilterQuery<IMessage>,
    options?: {
      sortField?: string;
      sortOrder?: 1 | -1;
      limit?: number;
      cursor?: string | null;
    },
  ) => Promise<{ messages: IMessage[]; nextCursor: string | null }>;
  countMessages: (filter: FilterQuery<IMessage>) => Promise<number>;
}

function parseLimit(raw: unknown): number {
  const parsed = parseInt(typeof raw === 'string' ? raw : '', 10);
  if (Number.isNaN(parsed)) {
    return DEFAULT_CONVERSATION_LIMIT;
  }
  return Math.min(Math.max(parsed, 1), MAX_CONVERSATION_LIMIT);
}

function toListItem(convo: IConversation, messageCount = 0): AdminConversationListItem {
  return {
    conversationId: convo.conversationId,
    title: convo.title ?? '',
    endpoint: convo.endpoint ?? '',
    model: convo.model ?? '',
    messageCount,
    isArchived: convo.isArchived ?? false,
    createdAt: convo.createdAt?.toISOString(),
    updatedAt: convo.updatedAt?.toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getMessageImages(message: IMessage, userId: string, conversationId: string) {
  const candidates = [message.files, message.attachments]
    .flatMap((items) => (Array.isArray(items) ? items : []))
    .filter(isRecord);
  const seen = new Set<string>();

  return candidates.flatMap((file) => {
    const fileId = typeof file.file_id === 'string' ? file.file_id : '';
    const type = typeof file.type === 'string' ? file.type : '';
    const declaredMimeType = typeof file.mimeType === 'string' ? file.mimeType : '';
    let mimeType = '';
    if (declaredMimeType.startsWith('image/')) {
      mimeType = declaredMimeType;
    } else if (type.startsWith('image/')) {
      mimeType = type;
    } else if (type === 'image') {
      mimeType = 'image/*';
    }
    if (!fileId || !/^[A-Za-z0-9_-]{1,128}$/.test(fileId) || !mimeType || seen.has(fileId)) {
      return [];
    }
    seen.add(fileId);

    return [
      {
        fileId,
        filename: typeof file.filename === 'string' ? file.filename : 'image',
        mimeType,
        ...(typeof file.width === 'number' && { width: file.width }),
        ...(typeof file.height === 'number' && { height: file.height }),
        ...(typeof file.context === 'string' && { context: file.context }),
        url: `/api/admin/conversations/${encodeURIComponent(userId)}/${encodeURIComponent(conversationId)}/images/${encodeURIComponent(fileId)}`,
      },
    ];
  });
}

function toMessageItem(
  message: IMessage,
  userId: string,
  conversationId: string,
): AdminConversationMessage {
  return {
    messageId: message.messageId,
    parentMessageId: message.parentMessageId,
    sender: message.sender ?? '',
    text: message.text ?? '',
    isCreatedByUser: message.isCreatedByUser,
    error: message.error ?? false,
    tokenCount: message.tokenCount,
    model: message.model,
    endpoint: message.endpoint,
    createdAt: message.createdAt?.toISOString(),
    images: getMessageImages(message, userId, conversationId),
  };
}

function parseDate(raw: unknown): Date | null | undefined {
  if (raw === undefined || raw === null || raw === '') {
    return undefined;
  }
  if (typeof raw !== 'string') {
    return null;
  }
  const value = new Date(raw);
  return Number.isNaN(value.getTime()) ? null : value;
}

export function createAdminConversationsHandlers(deps: AdminConversationsDeps): {
  listConversations: (req: ServerRequest, res: Response) => Promise<Response>;
  getConversationMessages: (req: ServerRequest, res: Response) => Promise<Response>;
  deleteConversation: (req: ServerRequest, res: Response) => Promise<Response>;
  getUserAssetStats: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  const {
    findUsers,
    getConvosByCursor,
    countConversations,
    getConvo,
    deleteConvos,
    getMessages,
    getMessagesByCursor,
    countMessages,
  } = deps;

  async function assertUserExists(userId: string): Promise<boolean> {
    const [user] = await findUsers({ _id: userId }, '_id', { limit: 1 });
    return Boolean(user);
  }

  /**
   * `getConvosByCursor` projects away the `messages` array, so counts are tallied
   * from a single `$in` query rather than one lookup per conversation.
   */
  async function countMessagesByConversation(
    userId: string,
    conversationIds: string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (!conversationIds.length) {
      return counts;
    }
    const messages = await getMessages(
      { conversationId: { $in: conversationIds }, user: userId },
      'conversationId',
    );
    for (const message of messages) {
      counts.set(message.conversationId, (counts.get(message.conversationId) ?? 0) + 1);
    }
    return counts;
  }

  async function listConversationsHandler(req: ServerRequest, res: Response) {
    try {
      const { userId } = req.params as unknown as UserIdParams;
      if (!isValidObjectIdString(userId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }
      if (!(await assertUserExists(userId))) {
        return res.status(404).json({ error: 'User not found' });
      }

      const rawCursor = req.query.cursor;
      const cursor = typeof rawCursor === 'string' && rawCursor ? rawCursor : null;
      const limit = parseLimit(req.query.limit);
      const updatedAfter = parseDate(req.query.startDate);
      const updatedBefore = parseDate(req.query.endDate);
      if (updatedAfter === null || updatedBefore === null) {
        return res.status(400).json({ error: 'startDate and endDate must be valid ISO dates' });
      }
      if (updatedAfter && updatedBefore && updatedAfter > updatedBefore) {
        return res.status(400).json({ error: 'startDate must not be after endDate' });
      }

      const dateFilter = {
        ...(updatedAfter && { $gte: updatedAfter }),
        ...(updatedBefore && { $lte: updatedBefore }),
      };

      const [{ conversations, nextCursor }, total] = await Promise.all([
        getConvosByCursor(userId, {
          cursor,
          limit,
          isArchived: null,
          updatedAfter,
          updatedBefore,
        }),
        countConversations({
          user: userId,
          ...(Object.keys(dateFilter).length > 0 && { updatedAt: dateFilter }),
        }),
      ]);

      const messageCounts = await countMessagesByConversation(
        userId,
        conversations.map((convo) => convo.conversationId),
      );

      return res.status(200).json({
        conversations: conversations.map((convo) =>
          toListItem(convo, messageCounts.get(convo.conversationId) ?? 0),
        ),
        nextCursor,
        total,
      });
    } catch (error) {
      logger.error('[adminConversations] listConversations error:', error);
      return res.status(500).json({ error: 'Failed to list conversations' });
    }
  }

  async function getConversationMessagesHandler(req: ServerRequest, res: Response) {
    try {
      const { userId, conversationId } = req.params as unknown as ConversationParams;
      if (!isValidObjectIdString(userId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }
      if (!CONVERSATION_ID_PATTERN.test(conversationId)) {
        return res.status(400).json({ error: 'Invalid conversation ID format' });
      }

      const convo = await getConvo(userId, conversationId);
      if (!convo) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const rawCursor = req.query.cursor;
      const cursor = typeof rawCursor === 'string' && rawCursor ? rawCursor : null;
      const limit = parseLimit(req.query.limit);
      const [{ messages, nextCursor }, total] = await Promise.all([
        getMessagesByCursor(
          { conversationId, user: userId },
          { cursor, limit, sortField: 'createdAt', sortOrder: -1 },
        ),
        countMessages({ conversationId, user: userId }),
      ]);

      return res.status(200).json({
        conversation: toListItem(convo, total),
        messages: messages.map((message) => toMessageItem(message, userId, conversationId)),
        nextCursor,
        total,
      });
    } catch (error) {
      logger.error('[adminConversations] getConversationMessages error:', error);
      return res.status(500).json({ error: 'Failed to load conversation' });
    }
  }

  async function deleteConversationHandler(req: ServerRequest, res: Response) {
    try {
      const { userId, conversationId } = req.params as unknown as ConversationParams;
      if (!isValidObjectIdString(userId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }
      if (!CONVERSATION_ID_PATTERN.test(conversationId)) {
        return res.status(400).json({ error: 'Invalid conversation ID format' });
      }

      const convo = await getConvo(userId, conversationId);
      if (!convo) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const result = await deleteConvos(userId, { conversationId });

      return res.status(200).json({
        deletedCount: result.deletedCount,
        messagesDeleted: result.messages?.deletedCount ?? 0,
      });
    } catch (error) {
      logger.error('[adminConversations] deleteConversation error:', error);
      return res.status(500).json({ error: 'Failed to delete conversation' });
    }
  }

  async function getUserAssetStatsHandler(req: ServerRequest, res: Response) {
    try {
      const { userId } = req.params as unknown as UserIdParams;
      if (!isValidObjectIdString(userId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }
      if (!(await assertUserExists(userId))) {
        return res.status(404).json({ error: 'User not found' });
      }

      const [conversationCount, messageCount, latest] = await Promise.all([
        countConversations({ user: userId }),
        countMessages({ user: userId }),
        getConvosByCursor(userId, { limit: 1 }),
      ]);

      const stats: AdminUserAssetStats = {
        conversationCount,
        messageCount,
        lastActiveAt: latest.conversations[0]?.updatedAt?.toISOString(),
      };

      return res.status(200).json(stats);
    } catch (error) {
      logger.error('[adminConversations] getUserAssetStats error:', error);
      return res.status(500).json({ error: 'Failed to load user asset stats' });
    }
  }

  return {
    listConversations: listConversationsHandler,
    getConversationMessages: getConversationMessagesHandler,
    deleteConversation: deleteConversationHandler,
    getUserAssetStats: getUserAssetStatsHandler,
  };
}
