/** Conversation summary returned by the admin conversation list endpoint. */
export type AdminConversationListItem = {
  conversationId: string;
  title: string;
  endpoint: string;
  model: string;
  messageCount: number;
  isArchived: boolean;
  createdAt?: string;
  updatedAt?: string;
};

/** Single message returned by the admin conversation detail endpoint. */
export type AdminConversationMessage = {
  messageId: string;
  parentMessageId?: string | null;
  sender: string;
  text: string;
  isCreatedByUser: boolean;
  error: boolean;
  tokenCount?: number;
  model?: string;
  endpoint?: string;
  createdAt?: string;
};

/** Aggregate conversation/message counters for a single user. */
export type AdminUserAssetStats = {
  conversationCount: number;
  messageCount: number;
  lastActiveAt?: string;
};
