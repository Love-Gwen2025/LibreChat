const { processDeleteRequest } = require('./process');
const { streamStoredFile } = require('./streamStoredFile');
const { logger } = require('@librechat/data-schemas');
const { FileSources } = require('librechat-data-provider');
const db = require('~/models');

function getFileOwnerId(file) {
  const ownerId = file?.user?.toString?.() ?? file?.user;
  if (typeof ownerId !== 'string' || !ownerId) {
    throw new Error('Image asset has no owner');
  }
  return ownerId;
}

/**
 * Storage strategies validate that paths belong to the user recorded on the
 * file. Admin actions are authorized separately, so the storage operation is
 * executed with a short-lived owner-scoped request clone.
 */
function createOwnerRequest(req, file) {
  const ownerId = getFileOwnerId(file);
  const ownerRequest = Object.create(req);
  ownerRequest.user = {
    ...(req.user ?? {}),
    id: ownerId,
    _id: ownerId,
    tenantId: file.tenantId,
  };
  ownerRequest.body = {};
  ownerRequest.config = req.config;
  return ownerRequest;
}

async function deleteAdminImageAsset(req, file) {
  const ownerRequest = createOwnerRequest(req, file);
  const result = await processDeleteRequest({ req: ownerRequest, files: [file] });
  if (result.failedFileIds.includes(file.file_id)) {
    throw new Error('Image asset storage deletion failed');
  }
  if (result.deletedFileIds.includes(file.file_id)) {
    try {
      await db.removeImageGenerationTaskOutput?.(file.file_id);
    } catch (error) {
      logger.warn(
        `[deleteAdminImageAsset] Image generation task cleanup failed for ${file.file_id}:`,
        error,
      );
    }
  }
  return result;
}

async function streamAdminImageAsset({ req, res, file, contentType }) {
  const ownerRequest = createOwnerRequest(req, file);
  const storedFile = file.source ? file : { ...file, source: FileSources.local };
  return streamStoredFile({
    req: ownerRequest,
    res,
    file: storedFile,
    disposition: 'inline',
    contentType,
    headers: {
      'Cache-Control': 'private, no-store',
    },
  });
}

module.exports = {
  createOwnerRequest,
  deleteAdminImageAsset,
  streamAdminImageAsset,
};
