const { logger, redactMessage } = require('@librechat/data-schemas');
const { getBuiltinImageAgentId } = require('@librechat/api');
const db = require('~/models');

function getRequestAgentId(req, endpointOption) {
  const agentId = endpointOption?.agent_id ?? req.body?.agent_id;
  return typeof agentId === 'string' && agentId ? agentId : null;
}

function getRequestAgentModel(req, endpointOption) {
  const model = endpointOption?.model_parameters?.model ?? req.body?.agent_model;
  return typeof model === 'string' && model ? model : '';
}

function getImageOutputs(response) {
  const attachments = Array.isArray(response?.attachments) ? response.attachments : [];
  const fileIds = [];
  for (const attachment of attachments) {
    const type =
      attachment && typeof attachment === 'object' && typeof attachment.type === 'string'
        ? attachment.type
        : '';
    const mimeType =
      attachment && typeof attachment === 'object' && typeof attachment.mimeType === 'string'
        ? attachment.mimeType
        : '';
    if (
      attachment &&
      typeof attachment === 'object' &&
      typeof attachment.file_id === 'string' &&
      attachment.file_id.length > 0 &&
      (type === 'image' || type.startsWith('image/') || mimeType.startsWith('image/'))
    ) {
      fileIds.push(attachment.file_id);
    }
  }
  return Array.from(new Set(fileIds));
}

async function createImageGenerationTask({
  req,
  endpointOption,
  streamId,
  conversationId,
  responseMessageId,
}) {
  const agentId = getRequestAgentId(req, endpointOption);
  const configuredAgentId = getBuiltinImageAgentId(req.config);
  if (!agentId || !configuredAgentId || agentId !== configuredAgentId || !responseMessageId) {
    return null;
  }

  try {
    await db.createImageGenerationTask({
      taskId: responseMessageId,
      streamId,
      conversationId,
      responseMessageId,
      user: req.user.id,
      agentId,
      model: getRequestAgentModel(req, endpointOption) || 'unknown',
      promptPreview: typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 500) : '',
      tenantId: req.user.tenantId,
    });
    return responseMessageId;
  } catch (error) {
    logger.error('[ImageGenerationTasks] Failed to create task:', error);
    return null;
  }
}

async function updateImageGenerationTask(taskId, update) {
  if (!taskId) {
    return;
  }
  try {
    await db.updateImageGenerationTask(taskId, update);
  } catch (error) {
    logger.error(`[ImageGenerationTasks] Failed to update task ${taskId}:`, error);
  }
}

async function completeImageGenerationTask(taskId, response) {
  const outputFileIds = getImageOutputs(response);
  if (outputFileIds.length === 0) {
    await updateImageGenerationTask(taskId, {
      status: 'failed',
      imageCount: 0,
      outputFileIds: [],
      completedAt: new Date(),
      error: 'No image was produced',
    });
    return;
  }
  await updateImageGenerationTask(taskId, {
    status: 'completed',
    imageCount: outputFileIds.length,
    outputFileIds,
    completedAt: new Date(),
    error: undefined,
  });
}

async function failImageGenerationTask(taskId, error) {
  const message = error instanceof Error ? error.message : String(error || 'Generation failed');
  await updateImageGenerationTask(taskId, {
    status: 'failed',
    completedAt: new Date(),
    error: redactMessage(message, 1000),
  });
}

async function cancelImageGenerationTask(taskId, reason = 'Request cancelled') {
  await updateImageGenerationTask(taskId, {
    status: 'cancelled',
    completedAt: new Date(),
    error: reason.slice(0, 1000),
  });
}

module.exports = {
  createImageGenerationTask,
  completeImageGenerationTask,
  failImageGenerationTask,
  cancelImageGenerationTask,
  getImageOutputs,
};
