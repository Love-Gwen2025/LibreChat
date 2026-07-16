import {
  logger,
  isValidObjectIdString,
  IMAGE_GENERATION_TASK_STATUSES,
} from '@librechat/data-schemas';
import type {
  IUser,
  IImageGenerationTask,
  AdminImageGenerationTask,
  ImageGenerationTaskStatus,
} from '@librechat/data-schemas';
import type { FilterQuery } from 'mongoose';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';

export interface AdminImageTasksDeps {
  listImageGenerationTasks: (options: {
    cursor?: string | null;
    limit?: number;
    userId?: string;
    status?: ImageGenerationTaskStatus;
  }) => Promise<{ tasks: IImageGenerationTask[]; nextCursor: string | null }>;
  countImageGenerationTasks: (filter: {
    userId?: string;
    status?: ImageGenerationTaskStatus;
  }) => Promise<number>;
  findUsers: (
    searchCriteria: FilterQuery<IUser>,
    fieldsToSelect?: string | string[] | null,
  ) => Promise<IUser[]>;
}

function parseLimit(raw: unknown): number {
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 25;
}

function isValidCursor(cursor: string): boolean {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as {
      createdAt?: string;
      id?: string;
    };
    return (
      typeof decoded.createdAt === 'string' &&
      !Number.isNaN(new Date(decoded.createdAt).getTime()) &&
      typeof decoded.id === 'string' &&
      isValidObjectIdString(decoded.id)
    );
  } catch {
    return false;
  }
}

export function createAdminImageTasksHandlers(deps: AdminImageTasksDeps): {
  listImageTasks: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  async function listImageTasksHandler(req: ServerRequest, res: Response) {
    try {
      const rawCursor = req.query.cursor;
      const cursor = typeof rawCursor === 'string' && rawCursor ? rawCursor : null;
      if (cursor && !isValidCursor(cursor)) {
        return res.status(400).json({ error: 'Invalid cursor' });
      }

      const rawUserId = req.query.userId;
      const userId = typeof rawUserId === 'string' && rawUserId ? rawUserId : undefined;
      if (userId && !isValidObjectIdString(userId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      const rawStatus = req.query.status;
      const status =
        typeof rawStatus === 'string' && rawStatus
          ? (rawStatus as ImageGenerationTaskStatus)
          : undefined;
      if (status && !IMAGE_GENERATION_TASK_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Invalid task status' });
      }

      const filter = { userId, status };
      const [{ tasks, nextCursor }, total] = await Promise.all([
        deps.listImageGenerationTasks({
          ...filter,
          cursor,
          limit: parseLimit(req.query.limit),
        }),
        deps.countImageGenerationTasks(filter),
      ]);
      const userIds = Array.from(new Set(tasks.map((task) => task.user.toString())));
      const users = userIds.length
        ? await deps.findUsers({ _id: { $in: userIds } }, '_id name email')
        : [];
      const usersById = new Map(users.map((user) => [user._id.toString(), user]));

      const items: AdminImageGenerationTask[] = tasks.map((task) => {
        const taskUserId = task.user.toString();
        const user = usersById.get(taskUserId);
        return {
          id: task._id.toString(),
          taskId: task.taskId,
          conversationId: task.conversationId,
          ...(task.responseMessageId && { responseMessageId: task.responseMessageId }),
          user: {
            id: taskUserId,
            name: user?.name ?? '',
            email: user?.email ?? '',
          },
          agentId: task.agentId,
          model: task.model,
          status: task.status,
          promptPreview: task.promptPreview,
          imageCount: task.imageCount,
          createdAt: task.createdAt?.toISOString(),
          updatedAt: task.updatedAt?.toISOString(),
          completedAt: task.completedAt?.toISOString(),
          ...(task.error && { error: task.error }),
        };
      });

      return res.status(200).json({ tasks: items, nextCursor, total });
    } catch (error) {
      logger.error('[adminImageTasks] listImageTasks error:', error);
      return res.status(500).json({ error: 'Failed to list image tasks' });
    }
  }

  return { listImageTasks: listImageTasksHandler };
}
