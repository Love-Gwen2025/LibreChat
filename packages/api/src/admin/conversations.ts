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
    options?: { cursor?: string | null; limit?: number },
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
  ) => Promise<IMessage[]>;
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

function toMessageItem(message: IMessage): AdminConversationMessage {
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
  };
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

      const [{ conversations, nextCursor }, total] = await Promise.all([
        getConvosByCursor(userId, { cursor, limit }),
        countConversations({ user: userId }),
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

      const messages = await getMessages({ conversationId, user: userId });

      return res.status(200).json({
        conversation: toListItem(convo, messages.length),
        messages: messages.map(toMessageItem),
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
