const express = require('express');
const request = require('supertest');

const userId = '507f1f77bcf86cd799439011';
const appConfig = { endpoints: { agents: { allowedProviders: ['openAI'] } } };

const mockRequireJwtAuth = jest.fn((req, _res, next) => {
  req.user = { id: 'admin-1', role: 'ADMIN' };
  next();
});
const mockConfigMiddleware = jest.fn((req, _res, next) => {
  req.config = appConfig;
  next();
});
const mockCapabilityMiddleware = jest.fn((_req, _res, next) => next());
const mockHandlers = {
  createUser: jest.fn((_req, res) => res.status(201).json({})),
  listUsers: jest.fn((_req, res) => res.status(200).json({ users: [] })),
  searchUsers: jest.fn((_req, res) => res.status(200).json({ users: [] })),
  updateUserRole: jest.fn((_req, res) => res.status(200).json({})),
  updateUserStatus: jest.fn((_req, res) => res.status(200).json({})),
  getUserAgentModels: jest.fn((req, res) => res.status(200).json({ config: req.config })),
  updateUserAgentModels: jest.fn((req, res) => res.status(200).json({ config: req.config })),
  deleteUser: jest.fn((_req, res) => res.status(200).json({})),
};

jest.mock('@librechat/api', () => ({
  createAdminUsersHandlers: jest.fn(() => mockHandlers),
}));

jest.mock('@librechat/data-schemas', () => ({
  SystemCapabilities: {
    ACCESS_ADMIN: 'access:admin',
    READ_USERS: 'read:users',
    MANAGE_USERS: 'manage:users',
    MANAGE_USER_MODELS: 'manage:user_models',
  },
}));

jest.mock('~/server/middleware/roles/capabilities', () => ({
  requireCapability: jest.fn(() => mockCapabilityMiddleware),
}));

jest.mock('~/server/middleware', () => ({
  configMiddleware: mockConfigMiddleware,
  requireJwtAuth: mockRequireJwtAuth,
}));

jest.mock('~/server/services/AuthService', () => ({ registerUser: jest.fn() }));
jest.mock('~/server/controllers/ModelController', () => ({ getModelsConfig: jest.fn() }));
jest.mock('~/models', () => ({}));

function createApp() {
  delete require.cache[require.resolve('./users')];
  const router = require('./users');
  const app = express();
  app.use(express.json());
  app.use('/api/admin/users', router);
  return app;
}

describe('admin user model routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['get', undefined],
    ['patch', { allowedModels: ['gpt-5.6-sol'] }],
  ])('loads the app config before %s /:id/models', async (method, body) => {
    const requestBuilder = request(createApp())[method](`/api/admin/users/${userId}/models`);
    const response = await (body ? requestBuilder.send(body) : requestBuilder).expect(200);

    expect(mockConfigMiddleware).toHaveBeenCalledTimes(1);
    expect(response.body).toEqual({ config: appConfig });
  });
});
