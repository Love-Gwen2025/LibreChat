const express = require('express');
const { createAdminConversationsHandlers } = require('@librechat/api');
const { logger, isValidObjectIdString, SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { configMiddleware, requireJwtAuth } = require('~/server/middleware');
const { streamStoredFile } = require('~/server/services/Files/streamStoredFile');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadUsers = requireCapability(SystemCapabilities.READ_USERS);
const requireManageUsers = requireCapability(SystemCapabilities.MANAGE_USERS);

const handlers = createAdminConversationsHandlers({
  findUsers: db.findUsers,
  getConvosByCursor: db.getConvosByCursor,
  countConversations: db.countConversations,
  getConvo: db.getConvo,
  deleteConvos: db.deleteConvos,
  getMessages: db.getMessages,
  getMessagesByCursor: db.getMessagesByCursor,
  countMessages: db.countMessages,
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/:userId/stats', requireReadUsers, handlers.getUserAssetStats);
router.get('/:userId', requireReadUsers, handlers.listConversations);
router.get(
  '/:userId/:conversationId/images/:fileId',
  requireReadUsers,
  configMiddleware,
  async (req, res) => {
    try {
      const { userId, conversationId, fileId } = req.params;
      if (!isValidObjectIdString(userId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(conversationId)) {
        return res.status(400).json({ error: 'Invalid conversation ID format' });
      }
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(fileId)) {
        return res.status(400).json({ error: 'Invalid file ID format' });
      }

      const [conversation, file] = await Promise.all([
        db.getConvo(userId, conversationId),
        db.findFileById(fileId, { user: userId }),
      ]);
      if (!conversation || !file) {
        return res.status(404).json({ error: 'Image not found' });
      }

      const supportedImageTypes = new Set([
        'image/png',
        'image/jpeg',
        'image/jpg',
        'image/webp',
        'image/gif',
        'image/avif',
        'image/bmp',
      ]);
      if (!supportedImageTypes.has(file.type)) {
        return res.status(415).json({ error: 'Unsupported image type' });
      }
      const configuredMaxImageBytes = Number(process.env.ADMIN_IMAGE_MAX_BYTES);
      const maxImageBytes =
        Number.isFinite(configuredMaxImageBytes) && configuredMaxImageBytes > 0
          ? configuredMaxImageBytes
          : 25 * 1024 * 1024;
      if (file.bytes > maxImageBytes) {
        return res.status(413).json({ error: 'Image is too large to preview' });
      }

      const references = await db.getMessages(
        {
          user: userId,
          conversationId,
          $or: [{ 'files.file_id': fileId }, { 'attachments.file_id': fileId }],
        },
        '_id',
        { limit: 1, sort: false },
      );
      if (references.length === 0) {
        return res.status(404).json({ error: 'Image not found' });
      }

      res.setHeader('Cache-Control', 'private, no-store');
      await streamStoredFile({
        req,
        res,
        file,
        disposition: 'inline',
        contentType: file.type,
      });
    } catch (error) {
      logger.error('[adminConversations] image preview error:', error);
      if (!res.headersSent) {
        res.status(error?.status || 500).json({ error: 'Failed to load image' });
      }
    }
  },
);
router.get('/:userId/:conversationId', requireReadUsers, handlers.getConversationMessages);
router.delete('/:userId/:conversationId', requireManageUsers, handlers.deleteConversation);

module.exports = router;
