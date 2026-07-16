const express = require('express');
const { createAdminImageTasksHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();
const handlers = createAdminImageTasksHandlers({
  listImageGenerationTasks: db.listImageGenerationTasks,
  countImageGenerationTasks: db.countImageGenerationTasks,
  findUsers: db.findUsers,
});

router.use(
  requireJwtAuth,
  requireCapability(SystemCapabilities.ACCESS_ADMIN),
  requireCapability(SystemCapabilities.READ_USERS),
);
router.get('/', handlers.listImageTasks);

module.exports = router;
