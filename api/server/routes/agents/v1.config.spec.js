const express = require('express');
const request = require('supertest');

const appConfig = {
  modelSpecs: {
    list: [{ name: 'image-generation', preset: { agent_id: 'agent-image' } }],
  },
};

const mockRequireJwtAuth = jest.fn((req, _res, next) => {
  req.user = { id: 'user-1', role: 'USER' };
  next();
});
const mockConfigMiddleware = jest.fn((req, _res, next) => {
  req.config = appConfig;
  next();
});
const mockPass = jest.fn((_req, _res, next) => next());
const mockHandlers = {
  getAgentCategories: jest.fn((_req, res) => res.status(200).json([])),
  createAgent: jest.fn((_req, res) => res.status(201).json({})),
  getAgent: jest.fn((req, res) => res.status(200).json({ config: req.config })),
  getAgentVersions: jest.fn((_req, res) => res.status(200).json([])),
  updateAgent: jest.fn((_req, res) => res.status(200).json({})),
  duplicateAgent: jest.fn((_req, res) => res.status(201).json({})),
  deleteAgent: jest.fn((_req, res) => res.status(200).json({})),
  revertAgentVersion: jest.fn((_req, res) => res.status(200).json({})),
  getListAgents: jest.fn((req, res) => res.status(200).json({ config: req.config })),
  uploadAgentAvatar: jest.fn((_req, res) => res.status(200).json({})),
};

jest.mock('@librechat/api', () => ({
  generateCheckAccess: jest.fn(() => mockPass),
}));

jest.mock('librechat-data-provider', () => ({
  PermissionTypes: { AGENTS: 'agents' },
  Permissions: { USE: 'use', CREATE: 'create' },
  PermissionBits: { VIEW: 1, EDIT: 2, DELETE: 4 },
}));

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: mockRequireJwtAuth,
  configMiddleware: mockConfigMiddleware,
  canAccessAgentResource: jest.fn(() => mockPass),
}));

jest.mock('~/server/controllers/agents/v1', () => mockHandlers);
jest.mock('~/models', () => ({ getRoleByName: jest.fn() }));
jest.mock('./actions', () => require('express').Router());
jest.mock('./tools', () => require('express').Router());

function createApp() {
  delete require.cache[require.resolve('./v1')];
  const { v1 } = require('./v1');
  const app = express();
  app.use('/api/agents', v1);
  return app;
}

describe('Agent model read routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(['/api/agents/agent-image', '/api/agents'])(
    'loads app config before serving %s',
    async (path) => {
      const response = await request(createApp()).get(path).expect(200);

      expect(mockConfigMiddleware).toHaveBeenCalledTimes(1);
      expect(response.body).toEqual({ config: appConfig });
    },
  );
});
