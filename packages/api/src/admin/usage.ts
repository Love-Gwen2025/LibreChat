import { logger, isValidObjectIdString } from '@librechat/data-schemas';
import type { IUser, AdminUserTokenUsage } from '@librechat/data-schemas';
import type { FilterQuery } from 'mongoose';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';

const MAX_DAILY_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

export interface AdminUsageDeps {
  findUsers: (
    searchCriteria: FilterQuery<IUser>,
    fieldsToSelect?: string | string[] | null,
    options?: { limit?: number },
  ) => Promise<IUser[]>;
  getUserTokenUsage: (params: {
    userId: string;
    start: Date;
    end: Date;
    timezone: string;
  }) => Promise<{
    totalTokens: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    todayTokens: number;
    daily: AdminUserTokenUsage['daily'];
  }>;
}

function parseOptionalDate(raw: unknown): Date | null | undefined {
  if (raw === undefined || raw === null || raw === '') {
    return undefined;
  }
  if (typeof raw !== 'string') {
    return null;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function createAdminUsageHandlers(deps: AdminUsageDeps): {
  getUserTokenUsage: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  async function getUserTokenUsageHandler(req: ServerRequest, res: Response) {
    try {
      const { userId } = req.params as { userId: string };
      if (!isValidObjectIdString(userId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      const timezone =
        typeof req.query.timezone === 'string' && req.query.timezone
          ? req.query.timezone
          : 'Asia/Shanghai';
      if (!isValidTimezone(timezone)) {
        return res.status(400).json({ error: 'Invalid timezone' });
      }

      const parsedEnd = parseOptionalDate(req.query.end);
      const parsedStart = parseOptionalDate(req.query.start);
      if (parsedStart === null || parsedEnd === null) {
        return res.status(400).json({ error: 'start and end must be valid ISO dates' });
      }
      const end = parsedEnd ?? new Date();
      const start = parsedStart ?? new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
      if (start > end) {
        return res.status(400).json({ error: 'start must not be after end' });
      }
      if (end.getTime() - start.getTime() > MAX_DAILY_RANGE_MS) {
        return res.status(400).json({ error: 'Daily usage range cannot exceed 366 days' });
      }

      const [user] = await deps.findUsers({ _id: userId }, '_id', { limit: 1 });
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const usage = await deps.getUserTokenUsage({ userId, start, end, timezone });
      const response: AdminUserTokenUsage = {
        ...usage,
        timezone,
        start: start.toISOString(),
        end: end.toISOString(),
      };
      return res.status(200).json(response);
    } catch (error) {
      logger.error('[adminUsage] getUserTokenUsage error:', error);
      return res.status(500).json({ error: 'Failed to load token usage' });
    }
  }

  return { getUserTokenUsage: getUserTokenUsageHandler };
}
