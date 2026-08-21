const express = require('express');
const mime = require('mime');
const { createAdminImageAssetsHandlers, isImageAsset } = require('@librechat/api');
const { logger, SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { configMiddleware, requireJwtAuth } = require('~/server/middleware');
const { deleteAdminImageAsset, streamAdminImageAsset } = require('~/server/services/Files/admin');
const db = require('~/models');

const router = express.Router();
const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadUsers = requireCapability(SystemCapabilities.READ_USERS);
const requireManageUsers = requireCapability(SystemCapabilities.MANAGE_USERS);
const fileIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
const imageTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
]);

const handlers = createAdminImageAssetsHandlers({
  listImageAssets: db.listImageAssets,
  countImageAssets: db.countImageAssets,
  findUsers: db.findUsers,
  findFileById: db.findFileById,
  deleteImageAsset: deleteAdminImageAsset,
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/', requireReadUsers, handlers.listImageAssets);

router.get('/:fileId/preview', requireReadUsers, configMiddleware, async (req, res) => {
  try {
    const { fileId } = req.params;
    if (!fileIdPattern.test(fileId)) {
      return res.status(400).json({ error: 'Invalid file ID format' });
    }

    const file = await db.findFileById(fileId);
    if (!file || !isImageAsset(file)) {
      return res.status(404).json({ error: 'Image asset not found' });
    }

    const configuredMaxImageBytes = Number(process.env.ADMIN_IMAGE_MAX_BYTES);
    const maxImageBytes =
      Number.isFinite(configuredMaxImageBytes) && configuredMaxImageBytes > 0
        ? configuredMaxImageBytes
        : 25 * 1024 * 1024;
    if (file.bytes > maxImageBytes) {
      return res.status(413).json({ error: 'Image is too large to preview' });
    }

    const declaredType = typeof file.type === 'string' ? file.type.toLowerCase() : '';
    const contentType = declaredType === 'image' ? mime.getType(file.filename) : declaredType;
    if (!contentType || !imageTypes.has(contentType)) {
      return res.status(415).json({ error: 'Unsupported image type' });
    }

    await streamAdminImageAsset({ req, res, file, contentType });
  } catch (error) {
    logger.error('[adminImageAssets] image preview error:', error);
    if (!res.headersSent) {
      res.status(error?.status || 500).json({ error: 'Failed to load image' });
    }
  }
});

router.delete('/:fileId', requireManageUsers, configMiddleware, handlers.deleteImageAsset);

module.exports = router;
