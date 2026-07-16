const mockCreateImageGenerationTask = jest.fn();
const mockUpdateImageGenerationTask = jest.fn();
const mockGetBuiltinImageAgentId = jest.fn();
const mockLogger = { error: jest.fn() };

jest.mock('@librechat/data-schemas', () => ({
  logger: mockLogger,
  redactMessage: jest.fn((message, limit) => message.slice(0, limit)),
}));
jest.mock('@librechat/api', () => ({
  getBuiltinImageAgentId: (...args) => mockGetBuiltinImageAgentId(...args),
}));
jest.mock('~/models', () => ({
  createImageGenerationTask: (...args) => mockCreateImageGenerationTask(...args),
  updateImageGenerationTask: (...args) => mockUpdateImageGenerationTask(...args),
}));

const {
  createImageGenerationTask,
  completeImageGenerationTask,
  failImageGenerationTask,
  cancelImageGenerationTask,
  getImageOutputs,
} = require('./ImageGenerationTasks');

describe('ImageGenerationTasks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetBuiltinImageAgentId.mockReturnValue('agent-image');
    mockCreateImageGenerationTask.mockResolvedValue({});
    mockUpdateImageGenerationTask.mockResolvedValue({});
  });

  const createParams = (overrides = {}) => ({
    req: {
      user: { id: 'user-1', tenantId: 'tenant-1' },
      body: { text: '  Draw a lighthouse  ', agent_id: 'agent-image', agent_model: 'gpt-image-a' },
      config: {},
    },
    endpointOption: { endpoint: 'agents' },
    streamId: 'stream-1',
    conversationId: 'conversation-1',
    responseMessageId: 'response-1',
    ...overrides,
  });

  it('creates a persistent running task for the configured image agent', async () => {
    await expect(createImageGenerationTask(createParams())).resolves.toBe('response-1');

    expect(mockCreateImageGenerationTask).toHaveBeenCalledWith({
      taskId: 'response-1',
      streamId: 'stream-1',
      conversationId: 'conversation-1',
      responseMessageId: 'response-1',
      user: 'user-1',
      agentId: 'agent-image',
      model: 'gpt-image-a',
      promptPreview: 'Draw a lighthouse',
      tenantId: 'tenant-1',
    });
  });

  it('does not track requests for another agent', async () => {
    const params = createParams();
    params.req.body.agent_id = 'agent-other';

    await expect(createImageGenerationTask(params)).resolves.toBeNull();
    expect(mockCreateImageGenerationTask).not.toHaveBeenCalled();
  });

  it('does not interrupt generation when task persistence fails', async () => {
    mockCreateImageGenerationTask.mockRejectedValue(new Error('database unavailable'));

    await expect(createImageGenerationTask(createParams())).resolves.toBeNull();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('deduplicates image outputs and ignores non-image attachments', () => {
    expect(
      getImageOutputs({
        attachments: [
          { file_id: 'image-1', type: 'image/png' },
          { file_id: 'image-1', type: 'image/png' },
          { file_id: 'image-2', type: 'image' },
          { file_id: 'image-3', type: 'artifact', mimeType: 'image/webp' },
          { file_id: 'document-1', type: 'application/pdf' },
          { file_id: '', type: 'image/jpeg' },
        ],
      }),
    ).toEqual(['image-1', 'image-2', 'image-3']);
  });

  it('marks a task completed with its generated image IDs', async () => {
    await completeImageGenerationTask('response-1', {
      attachments: [
        { file_id: 'image-1', type: 'image/png' },
        { file_id: 'image-2', type: 'image/webp' },
      ],
    });

    expect(mockUpdateImageGenerationTask).toHaveBeenCalledWith(
      'response-1',
      expect.objectContaining({
        status: 'completed',
        imageCount: 2,
        outputFileIds: ['image-1', 'image-2'],
        completedAt: expect.any(Date),
      }),
    );
  });

  it('marks a nominally completed task failed when no image was produced', async () => {
    await completeImageGenerationTask('response-1', { attachments: [] });

    expect(mockUpdateImageGenerationTask).toHaveBeenCalledWith(
      'response-1',
      expect.objectContaining({
        status: 'failed',
        imageCount: 0,
        outputFileIds: [],
        error: 'No image was produced',
      }),
    );
  });

  it('records failed and cancelled terminal states', async () => {
    await failImageGenerationTask('response-1', new Error('provider failed'));
    await cancelImageGenerationTask('response-2', 'Request aborted');

    expect(mockUpdateImageGenerationTask).toHaveBeenNthCalledWith(
      1,
      'response-1',
      expect.objectContaining({ status: 'failed', error: 'provider failed' }),
    );
    expect(mockUpdateImageGenerationTask).toHaveBeenNthCalledWith(
      2,
      'response-2',
      expect.objectContaining({ status: 'cancelled', error: 'Request aborted' }),
    );
  });
});
