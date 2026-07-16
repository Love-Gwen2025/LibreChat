const { EModelEndpoint } = require('librechat-data-provider');

const mockGetOpenAIModels = jest.fn();
const mockGetAnthropicModels = jest.fn();
const mockGetBedrockModels = jest.fn();
const mockGetGoogleModels = jest.fn();
const mockLogger = { error: jest.fn() };

jest.mock('@librechat/data-schemas', () => ({ logger: mockLogger }));
jest.mock('@librechat/api', () => ({
  mergeHeaders: jest.fn((_global, endpoint) => endpoint),
  getOpenAIModels: (...args) => mockGetOpenAIModels(...args),
  getAnthropicModels: (...args) => mockGetAnthropicModels(...args),
  getBedrockModels: (...args) => mockGetBedrockModels(...args),
  getGoogleModels: (...args) => mockGetGoogleModels(...args),
}));
jest.mock('./app', () => ({ getAppConfig: jest.fn() }));

const loadDefaultModels = require('./loadDefaultModels');

const createReq = (openAI) => ({
  user: { id: 'user-1' },
  config: { endpoints: { [EModelEndpoint.openAI]: openAI } },
});

const getDirectOpenAICalls = () =>
  mockGetOpenAIModels.mock.calls.filter(
    ([options]) => !options.azure && !options.assistants && !options.azureAssistants,
  );

describe('loadDefaultModels OpenAI configuration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOpenAIModels.mockResolvedValue(['fetched-model']);
    mockGetAnthropicModels.mockResolvedValue([]);
    mockGetBedrockModels.mockReturnValue([]);
    mockGetGoogleModels.mockReturnValue([]);
  });

  it('uses configured defaults without fetching when fetch is false', async () => {
    const result = await loadDefaultModels(
      createReq({
        models: {
          default: ['gpt-5.6-sol', { name: 'gpt-5.6-terra', description: 'Terra' }],
          fetch: false,
        },
      }),
    );

    expect(result[EModelEndpoint.openAI]).toEqual(['gpt-5.6-sol', 'gpt-5.6-terra']);
    expect(getDirectOpenAICalls()).toHaveLength(0);
  });

  it('uses fetched models when fetching is enabled', async () => {
    const result = await loadDefaultModels(
      createReq({ models: { default: ['configured-model'], fetch: true } }),
    );

    expect(result[EModelEndpoint.openAI]).toEqual(['fetched-model']);
    expect(getDirectOpenAICalls()).toEqual([[expect.objectContaining({ user: 'user-1' })]]);
  });

  it('falls back to configured defaults when model fetching fails', async () => {
    mockGetOpenAIModels.mockRejectedValue(new Error('provider unavailable'));

    const result = await loadDefaultModels(
      createReq({ models: { default: ['configured-model'], fetch: true } }),
    );

    expect(result[EModelEndpoint.openAI]).toEqual(['configured-model']);
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
