import { FileContext } from 'librechat-data-provider';
import { logger, isValidObjectIdString } from '@librechat/data-schemas';
import type {
  AdminImageAsset,
  IMongoFile,
  IUser,
  ListImageAssetsOptions,
} from '@librechat/data-schemas';
import type { FilterQuery } from 'mongoose';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';

const MAX_IMAGE_ASSET_LIMIT = 100;
const DEFAULT_IMAGE_ASSET_LIMIT = 25;
const MAX_CURSOR_LENGTH = 512;
const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export interface AdminImageAssetsDeps {
  listImageAssets: (
    options: ListImageAssetsOptions,
  ) => Promise<{ files: IMongoFile[]; nextCursor: string | null }>;
  countImageAssets: (filter: { userId?: string }) => Promise<number>;
  findUsers: (
    searchCriteria: FilterQuery<IUser>,
    fieldsToSelect?: string | string[] | null,
  ) => Promise<IUser[]>;
  findFileById: (fileId: string) => Promise<IMongoFile | null>;
  deleteImageAsset: (
    req: ServerRequest,
    file: IMongoFile,
  ) => Promise<{ deletedFileIds: string[]; failedFileIds: string[] }>;
}

function parseLimit(raw: unknown): number {
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1), MAX_IMAGE_ASSET_LIMIT)
    : DEFAULT_IMAGE_ASSET_LIMIT;
}

function isValidCursor(cursor: string): boolean {
  if (cursor.length > MAX_CURSOR_LENGTH) {
    return false;
  }

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

export function isImageAsset(file: Pick<IMongoFile, 'context' | 'type'>): boolean {
  if (file.context !== FileContext.image_generation) {
    return false;
  }
  const type = typeof file.type === 'string' ? file.type.toLowerCase() : '';
  return type === 'image' || type.startsWith('image/');
}

function mapImageAsset(file: IMongoFile, usersById: Map<string, IUser>): AdminImageAsset {
  const userId = file.user.toString();
  const user = usersById.get(userId);
  return {
    id: file.file_id,
    filename: file.filename,
    mimeType: file.type,
    bytes: file.bytes,
    ...(typeof file.width === 'number' && { width: file.width }),
    ...(typeof file.height === 'number' && { height: file.height }),
    user: {
      id: userId,
      name: user?.name ?? '',
      email: user?.email ?? '',
    },
    ...(file.conversationId && { conversationId: file.conversationId }),
    ...(file.messageId && { messageId: file.messageId }),
    ...(file.createdAt && { createdAt: file.createdAt.toISOString() }),
    ...(file.updatedAt && { updatedAt: file.updatedAt.toISOString() }),
    previewUrl: '/api/admin/image-assets/' + encodeURIComponent(file.file_id) + '/preview',
  };
}

export function createAdminImageAssetsHandlers(deps: AdminImageAssetsDeps): {
  listImageAssets: (req: ServerRequest, res: Response) => Promise<Response>;
  deleteImageAsset: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  async function listImageAssetsHandler(req: ServerRequest, res: Response) {
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

      const filter = { userId };
      const [{ files, nextCursor }, total] = await Promise.all([
        deps.listImageAssets({
          cursor,
          limit: parseLimit(req.query.limit),
          ...filter,
        }),
        deps.countImageAssets(filter),
      ]);

      const userIds = Array.from(new Set(files.map((file) => file.user.toString())));
      const users = userIds.length
        ? await deps.findUsers({ _id: { $in: userIds } }, '_id name email')
        : [];
      const usersById = new Map(users.map((user) => [user._id.toString(), user]));

      return res.status(200).json({
        assets: files.filter(isImageAsset).map((file) => mapImageAsset(file, usersById)),
        nextCursor,
        total,
      });
    } catch (error) {
      logger.error('[adminImageAssets] listImageAssets error:', error);
      return res.status(500).json({ error: 'Failed to list image assets' });
    }
  }

  async function deleteImageAssetHandler(req: ServerRequest, res: Response) {
    try {
      const { fileId } = req.params as { fileId?: string };
      if (!fileId || !FILE_ID_PATTERN.test(fileId)) {
        return res.status(400).json({ error: 'Invalid file ID format' });
      }

      const file = await deps.findFileById(fileId);
      if (!file || !isImageAsset(file)) {
        return res.status(404).json({ error: 'Image asset not found' });
      }

      const result = await deps.deleteImageAsset(req, file);
      if (result.failedFileIds.includes(file.file_id)) {
        return res.status(500).json({ error: 'Failed to delete image asset' });
      }

      if (!result.deletedFileIds.includes(file.file_id)) {
        logger.error('[adminImageAssets] image asset deletion did not confirm completion', {
          fileId: file.file_id,
        });
        return res.status(500).json({ error: 'Failed to delete image asset' });
      }

      return res.status(200).json({
        fileId: file.file_id,
        deleted: true,
      });
    } catch (error) {
      logger.error('[adminImageAssets] deleteImageAsset error:', error);
      return res.status(500).json({ error: 'Failed to delete image asset' });
    }
  }

  return {
    listImageAssets: listImageAssetsHandler,
    deleteImageAsset: deleteImageAssetHandler,
  };
}
