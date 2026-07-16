const express = require('express');
const { createAdminUsageHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();
const handlers = createAdminUsageHandlers({
  findUsers: db.findUsers,
  getUserTokenUsage: db.getUserTokenUsage,
});

router.use(
  requireJwtAuth,
  requireCapability(SystemCapabilities.ACCESS_ADMIN),
  requireCapability(SystemCapabilities.READ_USAGE),
);
router.get('/users/:userId/tokens', handlers.getUserTokenUsage);

module.exports = router;
