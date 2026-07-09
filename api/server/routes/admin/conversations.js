const express = require('express');
const { createAdminConversationsHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
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
  countMessages: db.countMessages,
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/:userId/stats', requireReadUsers, handlers.getUserAssetStats);
router.get('/:userId', requireReadUsers, handlers.listConversations);
router.get('/:userId/:conversationId', requireReadUsers, handlers.getConversationMessages);
router.delete('/:userId/:conversationId', requireManageUsers, handlers.deleteConversation);

module.exports = router;
