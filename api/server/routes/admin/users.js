const express = require('express');
const { createAdminUsersHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { configMiddleware, requireJwtAuth } = require('~/server/middleware');
const { registerUser } = require('~/server/services/AuthService');
const { getModelsConfig } = require('~/server/controllers/ModelController');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadUsers = requireCapability(SystemCapabilities.READ_USERS);
const requireManageUsers = requireCapability(SystemCapabilities.MANAGE_USERS);
const requireManageUserModels = requireCapability(SystemCapabilities.MANAGE_USER_MODELS);

const handlers = createAdminUsersHandlers({
  findUser: db.findUser,
  findUsers: db.findUsers,
  countUsers: db.countUsers,
  deleteUserById: db.deleteUserById,
  deleteConfig: db.deleteConfig,
  deleteAclEntries: db.deleteAclEntries,
  updateUser: db.updateUser,
  updateUserAgentModels: db.updateUserAgentModels,
  deleteAllUserSessions: db.deleteAllUserSessions,
  getAgent: db.getAgent,
  getModelsConfig,
  deleteConvos: db.deleteConvos,
  deleteMessages: db.deleteMessages,
  registerUser,
});

router.use(requireJwtAuth, requireAdminAccess);

router.post('/', requireManageUsers, handlers.createUser);
router.get('/', requireReadUsers, handlers.listUsers);
router.get('/search', requireReadUsers, handlers.searchUsers);
router.patch('/:id/name', requireManageUsers, handlers.updateUserName);
router.patch('/:id/role', requireManageUsers, handlers.updateUserRole);
router.patch('/:id/status', requireManageUsers, handlers.updateUserStatus);
router.get('/:id/models', requireManageUserModels, configMiddleware, handlers.getUserAgentModels);
router.patch(
  '/:id/models',
  requireManageUserModels,
  configMiddleware,
  handlers.updateUserAgentModels,
);
router.delete('/:id', requireManageUsers, handlers.deleteUser);

module.exports = router;
