import type { FilterQuery, Model } from 'mongoose';
import type { IImageGenerationTask, ImageGenerationTaskStatus } from '~/types/imageGenerationTask';

export interface CreateImageGenerationTaskInput {
  taskId: string;
  streamId: string;
  conversationId: string;
  responseMessageId?: string;
  user: string;
  agentId: string;
  model: string;
  promptPreview: string;
  tenantId?: string;
}

export interface ListImageGenerationTasksOptions {
  cursor?: string | null;
  limit?: number;
  userId?: string;
  status?: ImageGenerationTaskStatus;
}

export function createImageGenerationTaskMethods(mongoose: typeof import('mongoose')): {
  createImageGenerationTask: (
    input: CreateImageGenerationTaskInput,
  ) => Promise<IImageGenerationTask>;
  updateImageGenerationTask: (
    taskId: string,
    update: Partial<
      Pick<
        IImageGenerationTask,
        | 'status'
        | 'model'
        | 'imageCount'
        | 'outputFileIds'
        | 'error'
        | 'startedAt'
        | 'completedAt'
        | 'responseMessageId'
      >
    >,
  ) => Promise<IImageGenerationTask | null>;
  listImageGenerationTasks: (
    options?: ListImageGenerationTasksOptions,
  ) => Promise<{ tasks: IImageGenerationTask[]; nextCursor: string | null }>;
  countImageGenerationTasks: (filter?: {
    userId?: string;
    status?: ImageGenerationTaskStatus;
  }) => Promise<number>;
  removeImageGenerationTaskOutput: (fileId: string) => Promise<number>;
} {
  const getModel = () => mongoose.models.ImageGenerationTask as Model<IImageGenerationTask>;

  async function createImageGenerationTask(input: CreateImageGenerationTaskInput) {
    const Task = getModel();
    return await Task.findOneAndUpdate(
      { taskId: input.taskId },
      {
        $setOnInsert: {
          ...input,
          status: 'running',
          startedAt: new Date(),
          imageCount: 0,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
    ).lean<IImageGenerationTask>();
  }

  async function updateImageGenerationTask(
    taskId: string,
    update: Partial<
      Pick<
        IImageGenerationTask,
        | 'status'
        | 'model'
        | 'imageCount'
        | 'outputFileIds'
        | 'error'
        | 'startedAt'
        | 'completedAt'
        | 'responseMessageId'
      >
    >,
  ) {
    const Task = getModel();
    return await Task.findOneAndUpdate(
      { taskId },
      { $set: update },
      { new: true, runValidators: true },
    ).lean<IImageGenerationTask>();
  }

  async function listImageGenerationTasks({
    cursor,
    limit = 25,
    userId,
    status,
  }: ListImageGenerationTasksOptions = {}) {
    const Task = getModel();
    const normalizedLimit = Math.min(Math.max(limit, 1), 100);
    const filters: FilterQuery<IImageGenerationTask>[] = [];
    if (userId) {
      filters.push({ user: userId });
    }
    if (status) {
      filters.push({ status });
    }
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as {
          createdAt: string;
          id: string;
        };
        const createdAt = new Date(decoded.createdAt);
        if (!Number.isNaN(createdAt.getTime()) && mongoose.Types.ObjectId.isValid(decoded.id)) {
          filters.push({
            $or: [
              { createdAt: { $lt: createdAt } },
              { createdAt, _id: { $lt: new mongoose.Types.ObjectId(decoded.id) } },
            ],
          });
        }
      } catch {
        // Invalid cursors are rejected by the HTTP boundary; retain a safe first-page fallback.
      }
    }

    let query: FilterQuery<IImageGenerationTask> = {};
    if (filters.length === 1) {
      query = filters[0];
    } else if (filters.length > 1) {
      query = { $and: filters };
    }
    const tasks = await Task.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(normalizedLimit + 1)
      .lean<IImageGenerationTask[]>();

    const hasMore = tasks.length > normalizedLimit;
    if (hasMore) {
      tasks.pop();
    }
    const last = tasks[tasks.length - 1];
    const nextCursor =
      hasMore && last?.createdAt
        ? Buffer.from(
            JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last._id.toString() }),
          ).toString('base64')
        : null;
    return { tasks, nextCursor };
  }

  async function countImageGenerationTasks({
    userId,
    status,
  }: { userId?: string; status?: ImageGenerationTaskStatus } = {}) {
    const Task = getModel();
    const filter: FilterQuery<IImageGenerationTask> = {
      ...(userId && { user: userId }),
      ...(status && { status }),
    };
    return await Task.countDocuments(filter);
  }

  async function removeImageGenerationTaskOutput(fileId: string): Promise<number> {
    if (!fileId) {
      return 0;
    }

    const Task = getModel();
    const tasks = await Task.find({ outputFileIds: fileId }).lean<IImageGenerationTask[]>();
    if (tasks.length === 0) {
      return 0;
    }

    await Promise.all(
      tasks.map((task) => {
        const outputFileIds = (task.outputFileIds ?? []).filter((id) => id !== fileId);
        return Task.updateOne(
          { _id: task._id },
          { $set: { outputFileIds, imageCount: outputFileIds.length } },
        );
      }),
    );
    return tasks.length;
  }

  return {
    createImageGenerationTask,
    updateImageGenerationTask,
    listImageGenerationTasks,
    countImageGenerationTasks,
    removeImageGenerationTaskOutput,
  };
}

export type ImageGenerationTaskMethods = ReturnType<typeof createImageGenerationTaskMethods>;
