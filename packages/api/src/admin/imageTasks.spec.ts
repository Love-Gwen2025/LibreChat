import { Types } from 'mongoose';
import type { IImageGenerationTask, IUser } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { AdminImageTasksDeps } from './imageTasks';
import { createAdminImageTasksHandlers } from './imageTasks';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const userId = new Types.ObjectId();

function createReqRes(query: Record<string, string> = {}) {
  const req = { query } as unknown as ServerRequest;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { req, res: { status } as unknown as Response, status, json };
}

function task(overrides: Partial<IImageGenerationTask> = {}): IImageGenerationTask {
  return {
    _id: new Types.ObjectId(),
    taskId: 'response-1',
    streamId: 'stream-1',
    conversationId: 'conversation-1',
    responseMessageId: 'response-1',
    user: userId,
    agentId: 'agent-image',
    model: 'gpt-image-a',
    status: 'running',
    promptPreview: 'Draw a lighthouse',
    imageCount: 0,
    createdAt: new Date('2026-07-15T10:00:00.000Z'),
    updatedAt: new Date('2026-07-15T10:00:01.000Z'),
    ...overrides,
  } as IImageGenerationTask;
}

function createDeps(overrides: Partial<AdminImageTasksDeps> = {}): AdminImageTasksDeps {
  return {
    listImageGenerationTasks: jest
      .fn()
      .mockResolvedValue({ tasks: [task()], nextCursor: 'next-page' }),
    countImageGenerationTasks: jest.fn().mockResolvedValue(4),
    findUsers: jest.fn().mockResolvedValue([
      {
        _id: userId,
        name: 'Image User',
        email: 'image@example.com',
      } as IUser,
    ]),
    ...overrides,
  };
}

describe('createAdminImageTasksHandlers', () => {
  it('lists mapped tasks with member identities and polling metadata', async () => {
    const deps = createDeps();
    const handlers = createAdminImageTasksHandlers(deps);
    const { req, res, status, json } = createReqRes({
      userId: userId.toString(),
      status: 'running',
      limit: '500',
    });

    await handlers.listImageTasks(req, res);

    expect(deps.listImageGenerationTasks).toHaveBeenCalledWith({
      userId: userId.toString(),
      status: 'running',
      cursor: null,
      limit: 100,
    });
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      tasks: [
        expect.objectContaining({
          taskId: 'response-1',
          status: 'running',
          user: { id: userId.toString(), name: 'Image User', email: 'image@example.com' },
        }),
      ],
      nextCursor: 'next-page',
      total: 4,
    });
  });

  it('rejects invalid member, status, and cursor filters', async () => {
    const deps = createDeps();
    const handlers = createAdminImageTasksHandlers(deps);
    for (const query of [
      { userId: 'not-an-id' },
      { status: 'pending' },
      { cursor: 'not-a-cursor' },
    ]) {
      const { req, res, status } = createReqRes(query);
      await handlers.listImageTasks(req, res);
      expect(status).toHaveBeenCalledWith(400);
    }
    expect(deps.listImageGenerationTasks).not.toHaveBeenCalled();
  });

  it('accepts a valid composite cursor', async () => {
    const deps = createDeps();
    const handlers = createAdminImageTasksHandlers(deps);
    const cursor = Buffer.from(
      JSON.stringify({
        createdAt: '2026-07-15T10:00:00.000Z',
        id: new Types.ObjectId().toString(),
      }),
    ).toString('base64');
    const { req, res, status } = createReqRes({ cursor });

    await handlers.listImageTasks(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(deps.listImageGenerationTasks).toHaveBeenCalledWith(expect.objectContaining({ cursor }));
  });
});
