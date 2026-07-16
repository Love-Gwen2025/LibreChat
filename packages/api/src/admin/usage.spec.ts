import { Types } from 'mongoose';
import type { IUser } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { AdminUsageDeps } from './usage';
import { createAdminUsageHandlers } from './usage';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const userId = new Types.ObjectId().toString();

function createReqRes(query: Record<string, string> = {}) {
  const req = { params: { userId }, query } as unknown as ServerRequest;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { req, res: { status } as unknown as Response, status, json };
}

function createDeps(overrides: Partial<AdminUsageDeps> = {}): AdminUsageDeps {
  return {
    findUsers: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId(userId) } as IUser]),
    getUserTokenUsage: jest.fn().mockResolvedValue({
      totalTokens: 120,
      totalPromptTokens: 80,
      totalCompletionTokens: 40,
      todayTokens: 15,
      daily: [{ date: '2026-07-15', promptTokens: 10, completionTokens: 5, totalTokens: 15 }],
    }),
    ...overrides,
  };
}

describe('createAdminUsageHandlers', () => {
  it('returns lifetime, current-day, and daily token usage', async () => {
    const deps = createDeps();
    const handlers = createAdminUsageHandlers(deps);
    const { req, res, status, json } = createReqRes({
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-07-15T23:59:59.999Z',
      timezone: 'Asia/Shanghai',
    });

    await handlers.getUserTokenUsage(req, res);

    expect(deps.getUserTokenUsage).toHaveBeenCalledWith({
      userId,
      start: new Date('2026-07-01T00:00:00.000Z'),
      end: new Date('2026-07-15T23:59:59.999Z'),
      timezone: 'Asia/Shanghai',
    });
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ totalTokens: 120, todayTokens: 15, timezone: 'Asia/Shanghai' }),
    );
  });

  it('rejects invalid timezones and reversed ranges before querying usage', async () => {
    const deps = createDeps();
    const handlers = createAdminUsageHandlers(deps);
    const invalidTimezone = createReqRes({ timezone: 'Mars/Olympus' });
    await handlers.getUserTokenUsage(invalidTimezone.req, invalidTimezone.res);
    expect(invalidTimezone.status).toHaveBeenCalledWith(400);

    const reversed = createReqRes({
      start: '2026-07-16T00:00:00.000Z',
      end: '2026-07-15T00:00:00.000Z',
    });
    await handlers.getUserTokenUsage(reversed.req, reversed.res);
    expect(reversed.status).toHaveBeenCalledWith(400);
    expect(deps.getUserTokenUsage).not.toHaveBeenCalled();
  });

  it('returns 404 when the member no longer exists', async () => {
    const handlers = createAdminUsageHandlers(
      createDeps({ findUsers: jest.fn().mockResolvedValue([]) }),
    );
    const { req, res, status } = createReqRes();

    await handlers.getUserTokenUsage(req, res);

    expect(status).toHaveBeenCalledWith(404);
  });
});
