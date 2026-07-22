import type { Document, Types } from 'mongoose';

export const IMAGE_GENERATION_TASK_STATUSES = [
  'queued',
  'running',
  'completed',
  'text_only',
  'failed',
  'cancelled',
] as const;

export type ImageGenerationTaskStatus = (typeof IMAGE_GENERATION_TASK_STATUSES)[number];

export interface IImageGenerationTask extends Document {
  taskId: string;
  streamId: string;
  conversationId: string;
  responseMessageId?: string;
  user: Types.ObjectId;
  agentId: string;
  model: string;
  status: ImageGenerationTaskStatus;
  promptPreview: string;
  imageCount: number;
  outputFileIds?: string[];
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
  tenantId?: string;
}
