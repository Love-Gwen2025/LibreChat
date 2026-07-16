const { Readable } = require('stream');
const { logger } = require('@librechat/data-schemas');
const { FileSources, EModelEndpoint, checkOpenAIStorage } = require('librechat-data-provider');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const { getOpenAIClient } = require('~/server/controllers/assistants/helpers');
const { getContentDisposition } = require('~/server/utils/files');

function pipeToResponse(stream, res) {
  if (!stream || typeof stream.pipe !== 'function') {
    const error = new Error('Storage provider returned an invalid download stream');
    error.status = 502;
    throw error;
  }
  stream.on('error', (error) => {
    logger.error('[streamStoredFile] Download stream failed:', error);
    if (!res.destroyed) {
      res.destroy(error);
    }
  });
  stream.pipe(res);
}

async function streamStoredFile({
  req,
  res,
  file,
  disposition = 'attachment',
  contentType = 'application/octet-stream',
  headers = {},
}) {
  const { getDownloadStream } = getStrategyFunctions(file.source);
  if (!getDownloadStream) {
    const error = new Error(`No download stream is available for source: ${file.source}`);
    error.status = 501;
    throw error;
  }

  const setResponseHeaders = () => {
    res.setHeader('Content-Disposition', getContentDisposition(file.filename, disposition));
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    for (const [name, value] of Object.entries(headers)) {
      res.setHeader(name, value);
    }
  };

  if (checkOpenAIStorage(file.source)) {
    if (!file.model) {
      const error = new Error('The model used when creating this file is not available');
      error.status = 400;
      throw error;
    }
    req.body = { ...(req.body ?? {}), model: file.model };
    const endpointMap = {
      [FileSources.openai]: EModelEndpoint.assistants,
      [FileSources.azure]: EModelEndpoint.azureAssistants,
    };
    const { openai } = await getOpenAIClient({
      req,
      res,
      overrideEndpoint: endpointMap[file.source],
    });
    const response = await getDownloadStream(file.file_id, openai);
    const stream =
      response.body && typeof response.body.getReader === 'function'
        ? Readable.fromWeb(response.body)
        : response.body;
    setResponseHeaders();
    pipeToResponse(stream, res);
    return;
  }

  const fileStream = await getDownloadStream(req, file.storageKey || file.filepath);
  setResponseHeaders();
  pipeToResponse(fileStream, res);
}

module.exports = { streamStoredFile };
