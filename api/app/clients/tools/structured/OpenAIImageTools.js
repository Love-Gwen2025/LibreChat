const axios = require('axios');
const { v4 } = require('uuid');
const OpenAI = require('openai');
const FormData = require('form-data');
const { logger } = require('@librechat/data-schemas');
const { tool } = require('@librechat/agents/langchain/tools');
const { ContentTypes, EImageOutputType } = require('librechat-data-provider');
const {
  logAxiosError,
  oaiToolkit,
  extractBaseURL,
  getProxyDispatcher,
  applyAxiosProxyConfig,
} = require('@librechat/api');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const { getFiles } = require('~/models');

const displayMessage =
  "The tool displayed an image. All generated images are already plainly visible, so don't repeat the descriptions in detail. Do not list download links as they are available in the UI already. The user may download the images by clicking on them, but do not mention anything about downloading to the user.";
const dataImageURLPattern = /^data:image\/(?:png|jpe?g|webp);base64,/i;

/**
 * Replaces unwanted characters from the input string
 * @param {string} inputString - The input string to process
 * @returns {string} - The processed string
 */
function replaceUnwantedChars(inputString) {
  return inputString
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/"/g, '')
    .trim();
}

function returnValue(value) {
  if (typeof value === 'string') {
    return [value, {}];
  } else if (typeof value === 'object') {
    if (Array.isArray(value)) {
      return value;
    }
    return [displayMessage, value];
  }
  return value;
}

function createAbortHandler() {
  return function () {
    logger.debug('[ImageGenOAI] Image generation aborted');
  };
}

/**
 * Converts an OpenAI-compatible image item into a displayable URL.
 * sub2api-compatible providers may use alternate base64 fields or return a URL.
 * @param {Record<string, unknown>} image - Image response item
 * @param {string} outputFormat - Requested image output format
 * @returns {string | null} - Displayable image URL
 */
function getImageContentURL(image, outputFormat) {
  if (!image || typeof image !== 'object') {
    return null;
  }

  const base64Image = [image.b64_json, image.base64, image.image_base64].find(
    (value) => typeof value === 'string' && value.trim(),
  );
  if (base64Image) {
    const trimmedBase64 = base64Image.trim();
    if (dataImageURLPattern.test(trimmedBase64)) {
      return trimmedBase64;
    }
    const normalizedFormat = String(outputFormat || '').toLowerCase();
    const format = Object.values(EImageOutputType).includes(normalizedFormat)
      ? normalizedFormat
      : EImageOutputType.PNG;
    return `data:image/${format};base64,${trimmedBase64}`;
  }

  if (typeof image.url !== 'string' || !image.url.trim()) {
    return null;
  }

  const imageURL = image.url.trim();
  if (dataImageURLPattern.test(imageURL)) {
    return imageURL;
  }

  try {
    const parsedURL = new URL(imageURL);
    return parsedURL.protocol === 'https:' || parsedURL.protocol === 'http:' ? imageURL : null;
  } catch {
    return null;
  }
}

/**
 * Builds the shared agent response for generated and edited images.
 * @param {Object} params - Result parameters
 * @param {unknown} params.images - Image response items
 * @param {string} params.outputFormat - Image output format
 * @param {string[]} [params.referencedImageIds] - Source image IDs used for editing
 * @returns {Array | null} - LangChain content-and-artifact result
 */
function createImageToolResult({ images, outputFormat, referencedImageIds = [] }) {
  if (!Array.isArray(images)) {
    return null;
  }

  const content = images
    .map((image) => getImageContentURL(image, outputFormat))
    .filter(Boolean)
    .map((url) => ({
      type: ContentTypes.IMAGE_URL,
      image_url: { url },
    }));

  if (!content.length) {
    return null;
  }

  const file_ids = content.map(() => v4());
  const generatedImageIds =
    file_ids.length === 1
      ? `generated_image_id: "${file_ids[0]}"`
      : `generated_image_ids: ${JSON.stringify(file_ids)}`;
  const referencedIds = referencedImageIds.length
    ? `\nreferenced_image_ids: ${JSON.stringify(referencedImageIds)}`
    : '';
  const response = [
    {
      type: ContentTypes.TEXT,
      text: `${displayMessage}\n\n${generatedImageIds}${referencedIds}`,
    },
  ];

  return [response, { content, file_ids }];
}

/**
 * Creates OpenAI Image tools (generation and editing)
 * @param {Object} fields - Configuration fields
 * @param {ServerRequest} fields.req - Whether the tool is being used in an agent context
 * @param {boolean} fields.isAgent - Whether the tool is being used in an agent context
 * @param {string} fields.IMAGE_GEN_OAI_API_KEY - The OpenAI API key
 * @param {boolean} [fields.override] - Whether to override the API key check, necessary for app initialization
 * @param {MongoFile[]} [fields.imageFiles] - The images to be used for editing
 * @param {string} [fields.imageOutputType] - The image output type configuration
 * @param {string} [fields.fileStrategy] - The file storage strategy
 * @returns {Array<ReturnType<tool>>} - Array of image tools
 */
function createOpenAIImageTools(fields = {}) {
  /** @type {boolean} Used to initialize the Tool without necessary variables. */
  const override = fields.override ?? false;
  /** @type {boolean} */
  if (!override && !fields.isAgent) {
    throw new Error('This tool is only available for agents.');
  }
  const { req } = fields;
  const imageOutputType = fields.imageOutputType || EImageOutputType.PNG;
  const appFileStrategy = fields.fileStrategy;

  const getApiKey = () => {
    const apiKey = process.env.IMAGE_GEN_OAI_API_KEY ?? '';
    if (!apiKey && !override) {
      throw new Error('Missing IMAGE_GEN_OAI_API_KEY environment variable.');
    }
    return apiKey;
  };

  let apiKey = fields.IMAGE_GEN_OAI_API_KEY ?? getApiKey();
  const closureConfig = { apiKey };

  const imageModel = process.env.IMAGE_GEN_OAI_MODEL || 'gpt-image-1';

  let baseURL = 'https://api.openai.com/v1/';
  let responseFormat;
  if (!override && process.env.IMAGE_GEN_OAI_BASEURL) {
    baseURL = extractBaseURL(process.env.IMAGE_GEN_OAI_BASEURL);
    closureConfig.baseURL = baseURL;
    responseFormat = 'b64_json';
  }

  // Note: Azure may not yet support the latest image generation models
  if (
    !override &&
    process.env.IMAGE_GEN_OAI_AZURE_API_VERSION &&
    process.env.IMAGE_GEN_OAI_BASEURL
  ) {
    baseURL = process.env.IMAGE_GEN_OAI_BASEURL;
    closureConfig.baseURL = baseURL;
    closureConfig.defaultQuery = { 'api-version': process.env.IMAGE_GEN_OAI_AZURE_API_VERSION };
    closureConfig.defaultHeaders = {
      'api-key': process.env.IMAGE_GEN_OAI_API_KEY,
      'Content-Type': 'application/json',
    };
    closureConfig.apiKey = process.env.IMAGE_GEN_OAI_API_KEY;
    responseFormat = undefined;
  }

  const imageFiles = fields.imageFiles ?? [];

  /**
   * Image Generation Tool
   */
  const imageGenTool = tool(
    async (
      {
        prompt,
        background = 'auto',
        n = 1,
        output_compression = 100,
        quality = 'auto',
        size = 'auto',
      },
      runnableConfig,
    ) => {
      if (!prompt) {
        throw new Error('Missing required field: prompt');
      }
      const clientConfig = { ...closureConfig };
      const proxyDispatcher = getProxyDispatcher();
      if (proxyDispatcher) {
        clientConfig.fetchOptions = {
          dispatcher: proxyDispatcher,
        };
      }

      /** @type {OpenAI} */
      const openai = new OpenAI(clientConfig);
      let output_format = imageOutputType;
      if (
        background === 'transparent' &&
        output_format !== EImageOutputType.PNG &&
        output_format !== EImageOutputType.WEBP
      ) {
        logger.warn(
          '[ImageGenOAI] Transparent background requires PNG or WebP format, defaulting to PNG',
        );
        output_format = EImageOutputType.PNG;
      }

      let resp;
      /** @type {AbortSignal} */
      let derivedSignal = null;
      /** @type {() => void} */
      let abortHandler = null;

      try {
        if (runnableConfig?.signal) {
          derivedSignal = AbortSignal.any([runnableConfig.signal]);
          abortHandler = createAbortHandler();
          derivedSignal.addEventListener('abort', abortHandler, { once: true });
        }

        resp = await openai.images.generate(
          {
            model: imageModel,
            prompt: replaceUnwantedChars(prompt),
            n: Math.min(Math.max(1, n), 10),
            background,
            ...(responseFormat ? { response_format: responseFormat } : {}),
            output_format,
            output_compression:
              output_format === EImageOutputType.WEBP || output_format === EImageOutputType.JPEG
                ? output_compression
                : undefined,
            quality,
            size,
          },
          {
            signal: derivedSignal,
          },
        );
      } catch (error) {
        const message = '[image_gen_oai] Problem generating the image:';
        logAxiosError({ error, message });
        return returnValue(`Something went wrong when trying to generate the image. The OpenAI API may be unavailable:
Error Message: ${error.message}`);
      } finally {
        if (abortHandler && derivedSignal) {
          derivedSignal.removeEventListener('abort', abortHandler);
        }
      }

      if (!resp) {
        return returnValue(
          'Something went wrong when trying to generate the image. The OpenAI API may be unavailable',
        );
      }

      // TODO: handle cost in `resp.usage`
      const imageResult = createImageToolResult({
        images: resp.data,
        outputFormat: resp.output_format || output_format,
      });

      if (!imageResult) {
        logger.warn('[ImageGenOAI] No supported image data in response', {
          dataCount: Array.isArray(resp.data) ? resp.data.length : 0,
          imageFields:
            Array.isArray(resp.data) && resp.data[0] && typeof resp.data[0] === 'object'
              ? Object.keys(resp.data[0])
              : [],
        });
        return returnValue(
          'No image data returned from OpenAI API. There may be a problem with the API or your configuration.',
        );
      }
      return imageResult;
    },
    oaiToolkit.image_gen_oai,
  );

  /**
   * Image Editing Tool
   */
  const imageEditTool = tool(
    async ({ prompt, image_ids, quality = 'auto', size = 'auto' }, runnableConfig) => {
      if (!prompt) {
        throw new Error('Missing required field: prompt');
      }

      const clientConfig = { ...closureConfig };
      const proxyDispatcher = getProxyDispatcher();
      if (proxyDispatcher) {
        clientConfig.fetchOptions = {
          dispatcher: proxyDispatcher,
        };
      }

      const formData = new FormData();
      formData.append('model', imageModel);
      formData.append('prompt', replaceUnwantedChars(prompt));
      // TODO: `mask` support
      // TODO: more than 1 image support
      // formData.append('n', n.toString());
      formData.append('quality', quality);
      formData.append('size', size);
      if (responseFormat) {
        formData.append('response_format', responseFormat);
      }
      formData.append('output_format', imageOutputType);

      /** @type {Record<FileSources, undefined | NodeStreamDownloader<File>>} */
      const streamMethods = {};

      const requestFilesMap = Object.fromEntries(imageFiles.map((f) => [f.file_id, { ...f }]));

      const orderedFiles = new Array(image_ids.length);
      const idsToFetch = [];
      const indexOfMissing = Object.create(null);

      for (let i = 0; i < image_ids.length; i++) {
        const id = image_ids[i];
        const file = requestFilesMap[id];

        if (file) {
          orderedFiles[i] = file;
        } else {
          idsToFetch.push(id);
          indexOfMissing[id] = i;
        }
      }

      if (idsToFetch.length) {
        const fetchedFiles = await getFiles(
          {
            user: req.user.id,
            file_id: { $in: idsToFetch },
            height: { $exists: true },
            width: { $exists: true },
          },
          {},
          {},
        );

        for (const file of fetchedFiles) {
          requestFilesMap[file.file_id] = file;
          orderedFiles[indexOfMissing[file.file_id]] = file;
        }
      }
      for (const imageFile of orderedFiles) {
        if (!imageFile) {
          continue;
        }
        /** @type {NodeStream<File>} */
        let stream;
        /** @type {NodeStreamDownloader<File>} */
        let getDownloadStream;
        const source = imageFile.source || appFileStrategy;
        if (!source) {
          throw new Error('No source found for image file');
        }
        if (streamMethods[source]) {
          getDownloadStream = streamMethods[source];
        } else {
          ({ getDownloadStream } = getStrategyFunctions(source));
          streamMethods[source] = getDownloadStream;
        }
        if (!getDownloadStream) {
          throw new Error(`No download stream method found for source: ${source}`);
        }
        stream = await getDownloadStream(req, imageFile.filepath);
        if (!stream) {
          throw new Error('Failed to get download stream for image file');
        }
        formData.append('image[]', stream, {
          filename: imageFile.filename,
          contentType: imageFile.type,
        });
      }

      /** @type {import('axios').RawAxiosHeaders} */
      let headers = {
        ...formData.getHeaders(),
      };

      if (process.env.IMAGE_GEN_OAI_AZURE_API_VERSION && process.env.IMAGE_GEN_OAI_BASEURL) {
        headers['api-key'] = apiKey;
      } else {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      /** @type {AbortSignal} */
      let derivedSignal = null;
      /** @type {() => void} */
      let abortHandler = null;

      try {
        if (runnableConfig?.signal) {
          derivedSignal = AbortSignal.any([runnableConfig.signal]);
          abortHandler = createAbortHandler();
          derivedSignal.addEventListener('abort', abortHandler, { once: true });
        }

        /** @type {import('axios').AxiosRequestConfig} */
        const axiosConfig = {
          headers,
          ...clientConfig,
          signal: derivedSignal,
          baseURL,
        };

        applyAxiosProxyConfig(axiosConfig, baseURL);

        if (process.env.IMAGE_GEN_OAI_AZURE_API_VERSION && process.env.IMAGE_GEN_OAI_BASEURL) {
          axiosConfig.params = {
            'api-version': process.env.IMAGE_GEN_OAI_AZURE_API_VERSION,
            ...axiosConfig.params,
          };
        }
        const response = await axios.post('/images/edits', formData, axiosConfig);

        const imageResult = createImageToolResult({
          images: response.data?.data,
          outputFormat: response.data?.output_format || imageOutputType,
          referencedImageIds: image_ids,
        });
        if (!imageResult) {
          logger.warn('[ImageEditOAI] No supported image data in response', {
            dataCount: Array.isArray(response.data?.data) ? response.data.data.length : 0,
            imageFields:
              Array.isArray(response.data?.data) &&
              response.data.data[0] &&
              typeof response.data.data[0] === 'object'
                ? Object.keys(response.data.data[0])
                : [],
          });
          return returnValue(
            'No image data returned from OpenAI API. There may be a problem with the API or your configuration.',
          );
        }
        return imageResult;
      } catch (error) {
        const message = '[image_edit_oai] Problem editing the image:';
        logAxiosError({ error, message });
        return returnValue(`Something went wrong when trying to edit the image. The OpenAI API may be unavailable:
Error Message: ${error.message || 'Unknown error'}`);
      } finally {
        if (abortHandler && derivedSignal) {
          derivedSignal.removeEventListener('abort', abortHandler);
        }
      }
    },
    oaiToolkit.image_edit_oai,
  );

  return [imageGenTool, imageEditTool];
}

module.exports = createOpenAIImageTools;
