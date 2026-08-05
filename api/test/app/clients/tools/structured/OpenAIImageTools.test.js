const axios = require('axios');
const OpenAI = require('openai');
const { ContentTypes } = require('librechat-data-provider');
const createOpenAIImageTools = require('~/app/clients/tools/structured/OpenAIImageTools');

jest.mock('axios');
jest.mock('openai');
jest.mock('@librechat/data-schemas', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('@librechat/api', () => ({
  logAxiosError: jest.fn(),
  oaiToolkit: {
    image_gen_oai: {
      name: 'image_gen_oai',
      description: 'Generate an image',
      schema: {},
    },
    image_edit_oai: {
      name: 'image_edit_oai',
      description: 'Edit an image',
      schema: {},
    },
  },
  extractBaseURL: jest.fn((url) => url),
  getProxyDispatcher: jest.fn(() => undefined),
  applyAxiosProxyConfig: jest.fn(),
  formatImageToolError: jest.requireActual('@librechat/api').formatImageToolError,
}));

jest.mock('~/server/services/Files/strategies', () => ({
  getStrategyFunctions: jest.fn(),
}));

jest.mock('~/models', () => ({
  getFiles: jest.fn().mockResolvedValue([]),
}));

describe('OpenAIImageTools - IMAGE_GEN_OAI_MODEL environment variable', () => {
  let originalEnv;

  beforeEach(() => {
    jest.clearAllMocks();
    originalEnv = { ...process.env };

    process.env.IMAGE_GEN_OAI_API_KEY = 'test-api-key';
    process.env.IMAGE_GEN_OAI_BASEURL = 'https://images.example.com/v1';

    OpenAI.mockImplementation(() => ({
      images: {
        generate: jest.fn().mockResolvedValue({
          data: [
            {
              b64_json: 'base64-encoded-image-data',
            },
          ],
        }),
      },
    }));
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should use default model "gpt-image-1" when IMAGE_GEN_OAI_MODEL is not set', async () => {
    delete process.env.IMAGE_GEN_OAI_MODEL;

    const [imageGenTool] = createOpenAIImageTools({
      isAgent: true,
      override: false,
      req: { user: { id: 'test-user' } },
    });

    const mockGenerate = jest.fn().mockResolvedValue({
      data: [
        {
          b64_json: 'base64-encoded-image-data',
        },
      ],
    });

    OpenAI.mockImplementation(() => ({
      images: {
        generate: mockGenerate,
      },
    }));

    await imageGenTool.func({ prompt: 'test prompt' });

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-image-1',
        response_format: 'b64_json',
      }),
      expect.any(Object),
    );
  });

  it('should use "gpt-image-1.5" when IMAGE_GEN_OAI_MODEL is set to "gpt-image-1.5"', async () => {
    process.env.IMAGE_GEN_OAI_MODEL = 'gpt-image-1.5';

    const mockGenerate = jest.fn().mockResolvedValue({
      data: [
        {
          b64_json: 'base64-encoded-image-data',
        },
      ],
    });

    OpenAI.mockImplementation(() => ({
      images: {
        generate: mockGenerate,
      },
    }));

    const [imageGenTool] = createOpenAIImageTools({
      isAgent: true,
      override: false,
      req: { user: { id: 'test-user' } },
    });

    await imageGenTool.func({ prompt: 'test prompt' });

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-image-1.5',
      }),
      expect.any(Object),
    );
  });

  it('should use custom model name from IMAGE_GEN_OAI_MODEL environment variable', async () => {
    process.env.IMAGE_GEN_OAI_MODEL = 'custom-image-model';

    const mockGenerate = jest.fn().mockResolvedValue({
      data: [
        {
          b64_json: 'base64-encoded-image-data',
        },
      ],
    });

    OpenAI.mockImplementation(() => ({
      images: {
        generate: mockGenerate,
      },
    }));

    const [imageGenTool] = createOpenAIImageTools({
      isAgent: true,
      override: false,
      req: { user: { id: 'test-user' } },
    });

    await imageGenTool.func({ prompt: 'test prompt' });

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'custom-image-model',
      }),
      expect.any(Object),
    );
  });

  it('does not send the compatibility response format to the native OpenAI endpoint', async () => {
    delete process.env.IMAGE_GEN_OAI_BASEURL;
    const mockGenerate = jest.fn().mockResolvedValue({
      data: [{ b64_json: 'base64-encoded-image-data' }],
    });
    OpenAI.mockImplementation(() => ({
      images: { generate: mockGenerate },
    }));

    const [imageGenTool] = createOpenAIImageTools({
      isAgent: true,
      override: false,
      req: { user: { id: 'test-user' } },
    });

    await imageGenTool.func({ prompt: 'test prompt' });

    expect(mockGenerate.mock.calls[0][0]).not.toHaveProperty('response_format');
  });

  it('supports URL image responses from OpenAI-compatible providers', async () => {
    const imageURL = 'https://cdn.example.com/generated.png';
    OpenAI.mockImplementation(() => ({
      images: {
        generate: jest.fn().mockResolvedValue({
          data: [{ url: imageURL }],
        }),
      },
    }));

    const [imageGenTool] = createOpenAIImageTools({
      isAgent: true,
      override: false,
      req: { user: { id: 'test-user' } },
    });

    const [, artifact] = await imageGenTool.func({ prompt: 'test prompt' });

    expect(artifact.content).toEqual([
      {
        type: ContentTypes.IMAGE_URL,
        image_url: { url: imageURL },
      },
    ]);
    expect(artifact.file_ids).toHaveLength(1);
  });

  it('supports sub2api base64 aliases and multiple returned images', async () => {
    OpenAI.mockImplementation(() => ({
      images: {
        generate: jest.fn().mockResolvedValue({
          output_format: 'webp',
          data: [{ base64: 'first-image' }, { image_base64: 'second-image' }],
        }),
      },
    }));

    const [imageGenTool] = createOpenAIImageTools({
      isAgent: true,
      override: false,
      req: { user: { id: 'test-user' } },
    });

    const [response, artifact] = await imageGenTool.func({ prompt: 'test prompt', n: 2 });

    expect(artifact.content).toEqual([
      {
        type: ContentTypes.IMAGE_URL,
        image_url: { url: 'data:image/webp;base64,first-image' },
      },
      {
        type: ContentTypes.IMAGE_URL,
        image_url: { url: 'data:image/webp;base64,second-image' },
      },
    ]);
    expect(artifact.file_ids).toHaveLength(2);
    expect(response[0].text).toContain('generated_image_ids: [');
  });

  it('requests base64 responses for edits and accepts a URL fallback', async () => {
    const imageURL = 'https://cdn.example.com/edited.png';
    axios.post.mockResolvedValue({
      data: {
        data: [{ url: imageURL }],
      },
    });

    const [, imageEditTool] = createOpenAIImageTools({
      isAgent: true,
      override: false,
      req: { user: { id: 'test-user' } },
    });

    const [response, artifact] = await imageEditTool.func({
      prompt: 'edit the image',
      image_ids: ['source-image-id'],
    });

    const requestForm = axios.post.mock.calls[0][1];
    const requestBody = requestForm.getBuffer().toString();
    expect(requestBody).toContain('name="response_format"');
    expect(requestBody).toContain('b64_json');
    expect(requestBody).toContain('name="output_format"');
    expect(artifact.content[0]).toEqual({
      type: ContentTypes.IMAGE_URL,
      image_url: { url: imageURL },
    });
    expect(response[0].text).toContain('referenced_image_ids: ["source-image-id"]');
  });

  it('returns the upstream content policy code and message to the agent', async () => {
    axios.post.mockRejectedValue({
      message: 'Request failed with status code 400',
      response: {
        status: 400,
        data: {
          error: {
            code: 'content_policy_violation',
            type: 'image_generation_user_error',
            message: 'This image request cannot be processed.',
          },
        },
      },
    });

    const [, imageEditTool] = createOpenAIImageTools({
      isAgent: true,
      override: false,
      req: { user: { id: 'test-user' } },
    });

    const [result] = await imageEditTool.func({
      prompt: 'edit the image',
      image_ids: ['source-image-id'],
    });

    expect(result).toContain('content_policy_violation');
    expect(result).toContain('This image request cannot be processed.');
    expect(result).not.toContain('OpenAI API may be unavailable');
  });
});
