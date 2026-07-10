const express = require('express');
const { createAdminUsersHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const { registerUser } = require('~/server/services/AuthService');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadUsers = requireCapability(SystemCapabilities.READ_USERS);
const requireManageUsers = requireCapability(SystemCapabilities.MANAGE_USERS);

const handlers = createAdminUsersHandlers({
  findUser: db.findUser,
  findUsers: db.findUsers,
  countUsers: db.countUsers,
  deleteUserById: db.deleteUserById,
  deleteConfig: db.deleteConfig,
  deleteAclEntries: db.deleteAclEntries,
  updateUser: db.updateUser,
  deleteConvos: db.deleteConvos,
  deleteMessages: db.deleteMessages,
  registerUser,
});

router.use(requireJwtAuth, requireAdminAccess);

router.post('/', requireManageUsers, handlers.createUser);
router.get('/', requireReadUsers, handlers.listUsers);
router.get('/search', requireReadUsers, handlers.searchUsers);
router.patch('/:id/role', requireManageUsers, handlers.updateUserRole);
router.delete('/:id', requireManageUsers, handlers.deleteUser);

module.exports = router;
