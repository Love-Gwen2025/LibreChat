import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IImageGenerationTask } from '~/types';
import { createImageGenerationTaskModel } from '~/models/imageGenerationTask';
import { createImageGenerationTaskMethods } from './imageGenerationTask';

let mongoServer: MongoMemoryServer;
let Task: mongoose.Model<IImageGenerationTask>;
let methods: ReturnType<typeof createImageGenerationTaskMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  Task = createImageGenerationTaskModel(mongoose);
  methods = createImageGenerationTaskMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
});

const input = (taskId: string, user: mongoose.Types.ObjectId) => ({
  taskId,
  streamId: `stream-${taskId}`,
  conversationId: `conversation-${taskId}`,
  responseMessageId: taskId,
  user: user.toString(),
  agentId: 'agent-image',
  model: 'gpt-image-a',
  promptPreview: `Prompt ${taskId}`,
});

describe('Image generation task methods', () => {
  test('creates idempotent running tasks and updates terminal state', async () => {
    const user = new mongoose.Types.ObjectId();
    const first = await methods.createImageGenerationTask(input('task-1', user));
    const second = await methods.createImageGenerationTask({
      ...input('task-1', user),
      promptPreview: 'A duplicate request must not overwrite the task',
    });

    expect(first.status).toBe('running');
    expect(second._id.toString()).toBe(first._id.toString());
    expect(second.promptPreview).toBe('Prompt task-1');
    expect(await Task.countDocuments()).toBe(1);

    const completed = await methods.updateImageGenerationTask('task-1', {
      status: 'completed',
      imageCount: 2,
      outputFileIds: ['image-1', 'image-2'],
      completedAt: new Date(),
    });
    expect(completed).toMatchObject({
      status: 'completed',
      imageCount: 2,
      outputFileIds: ['image-1', 'image-2'],
    });
  });

  test('paginates deterministically and applies member and status filters', async () => {
    const user = new mongoose.Types.ObjectId();
    const otherUser = new mongoose.Types.ObjectId();
    await methods.createImageGenerationTask(input('task-1', user));
    await methods.createImageGenerationTask(input('task-2', user));
    await methods.createImageGenerationTask(input('task-3', otherUser));
    const sameCreatedAt = new Date('2026-07-15T10:00:00.000Z');
    await Task.updateMany({}, { $set: { createdAt: sameCreatedAt } }, { timestamps: false });
    await methods.updateImageGenerationTask('task-1', { status: 'completed' });

    const firstPage = await methods.listImageGenerationTasks({ limit: 2 });
    expect(firstPage.tasks).toHaveLength(2);
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const secondPage = await methods.listImageGenerationTasks({
      limit: 2,
      cursor: firstPage.nextCursor,
    });
    expect(secondPage.tasks).toHaveLength(1);
    expect(new Set([...firstPage.tasks, ...secondPage.tasks].map((task) => task.taskId)).size).toBe(
      3,
    );

    const completed = await methods.listImageGenerationTasks({
      userId: user.toString(),
      status: 'completed',
    });
    expect(completed.tasks.map((task) => task.taskId)).toEqual(['task-1']);
    await expect(methods.countImageGenerationTasks({ userId: user.toString() })).resolves.toBe(2);
  });
});
