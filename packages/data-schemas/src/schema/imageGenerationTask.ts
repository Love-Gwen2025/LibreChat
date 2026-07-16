import mongoose, { Schema } from 'mongoose';
import { IMAGE_GENERATION_TASK_STATUSES } from '~/types/imageGenerationTask';
import type { IImageGenerationTask } from '~/types/imageGenerationTask';

const imageGenerationTaskSchema = new Schema<IImageGenerationTask>(
  {
    taskId: { type: String, required: true, maxlength: 256 },
    streamId: { type: String, required: true, maxlength: 128 },
    conversationId: { type: String, required: true, maxlength: 128 },
    responseMessageId: { type: String, maxlength: 256 },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    agentId: { type: String, required: true, maxlength: 256, index: true },
    model: { type: String, required: true, maxlength: 256 },
    status: {
      type: String,
      enum: IMAGE_GENERATION_TASK_STATUSES,
      required: true,
      default: 'queued',
      index: true,
    },
    promptPreview: { type: String, default: '', maxlength: 500 },
    imageCount: { type: Number, default: 0, min: 0 },
    outputFileIds: { type: [String], default: undefined },
    error: { type: String, maxlength: 1000 },
    startedAt: Date,
    completedAt: Date,
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

imageGenerationTaskSchema.index({ taskId: 1, tenantId: 1 }, { unique: true });
imageGenerationTaskSchema.index({ createdAt: -1, _id: -1, tenantId: 1 });
imageGenerationTaskSchema.index({ status: 1, updatedAt: -1, tenantId: 1 });
imageGenerationTaskSchema.index({ user: 1, createdAt: -1, tenantId: 1 });

export default imageGenerationTaskSchema;
