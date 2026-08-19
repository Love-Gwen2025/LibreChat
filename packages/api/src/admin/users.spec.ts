import { Types } from 'mongoose';
import { PrincipalType, SystemRoles } from 'librechat-data-provider';
import type { IUser, UserDeleteResult } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { AdminUsersDeps } from './users';
import { createAdminUsersHandlers } from './users';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const validUserId = new Types.ObjectId().toString();
const addedImageModels = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];

function mockUser(overrides: Partial<IUser> = {}): IUser {
  return {
    _id: new Types.ObjectId(),
    name: 'Test User',
    username: 'testuser',
    email: 'test@example.com',
    avatar: 'https://example.com/avatar.png',
    role: 'USER',
    provider: 'local',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-06-01'),
    ...overrides,
  } as IUser;
}

function createReqRes(
  overrides: {
    params?: Record<string, string>;
    query?: Record<string, string | string[]>;
    body?: Record<string, unknown>;
    user?: { _id?: Types.ObjectId; id?: string; role?: string; tenantId?: string };
  } = {},
) {
  const req = {
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    body: overrides.body ?? {},
    user: overrides.user ?? { _id: new Types.ObjectId(), role: 'admin' },
    config: {
      modelSpecs: {
        list: [{ name: 'image-generation', preset: { agent_id: 'agent-image' } }],
      },
    },
  } as unknown as ServerRequest;

  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;

  return { req, res, status, json };
}

function createDeps(overrides: Partial<AdminUsersDeps> = {}): AdminUsersDeps {
  return {
    findUser: jest.fn().mockResolvedValue(null),
    findUsers: jest.fn().mockResolvedValue([]),
    countUsers: jest.fn().mockResolvedValue(0),
    deleteUserById: jest
      .fn()
      .mockResolvedValue({ deletedCount: 1, message: 'User was deleted successfully.' }),
    deleteConfig: jest.fn().mockResolvedValue(null),
    deleteAclEntries: jest.fn().mockResolvedValue(undefined),
    hashPassword: jest.fn().mockResolvedValue('hashed-password'),
    minPasswordLength: 8,
    updateUser: jest.fn().mockResolvedValue(mockUser()),
    updateUserAgentModels: jest.fn().mockResolvedValue(mockUser()),
    deleteAllUserSessions: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    getAgent: jest.fn().mockResolvedValue({
      id: 'agent-image',
      provider: 'openai',
      allowed_models: ['gpt-image-a', 'gpt-image-b'],
    }),
    getModelsConfig: jest.fn().mockResolvedValue({
      openAI: ['gpt-image-a', 'gpt-image-b', ...addedImageModels],
    }),
    deleteConvos: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    deleteMessages: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    registerUser: jest.fn().mockResolvedValue({ status: 200, message: 'Created' }),
    ...overrides,
  };
}

describe('createAdminUsersHandlers', () => {
  describe('createUser', () => {
    const validRegistration = {
      name: '  New User  ',
      username: '  New.User  ',
      email: '  NEW@EXAMPLE.COM  ',
      password: 'Password123!',
      confirmPassword: 'Password123!',
    };

    it('creates a normalized, verified local USER and returns only safe fields', async () => {
      const created = mockUser({
        name: 'New User',
        username: 'new.user',
        email: 'new@example.com',
      });
      const findUser = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(created);
      const deps = createDeps({ findUser });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        body: {
          ...validRegistration,
          role: SystemRoles.ADMIN,
          emailVerified: false,
          provider: 'google',
        },
      });

      await handlers.createUser(req, res);

      expect(findUser).toHaveBeenNthCalledWith(
        1,
        { $or: [{ email: 'new@example.com' }, { username: 'new.user' }] },
        '_id email username',
      );
      expect(deps.registerUser).toHaveBeenCalledWith(
        {
          name: 'New User',
          username: 'new.user',
          email: 'new@example.com',
          password: validRegistration.password,
          confirm_password: validRegistration.confirmPassword,
        },
        { role: SystemRoles.USER, emailVerified: true },
      );
      expect(findUser).toHaveBeenNthCalledWith(2, { email: 'new@example.com' }, expect.any(String));
      expect(status).toHaveBeenCalledWith(201);
      expect(json).toHaveBeenCalledWith({
        user: expect.objectContaining({
          id: created._id.toString(),
          email: 'new@example.com',
          username: 'new.user',
          role: SystemRoles.USER,
          provider: 'local',
        }),
      });
      expect(json.mock.calls[0][0].user).not.toHaveProperty('password');
    });

    it('omits an empty username from the conflict query', async () => {
      const created = mockUser({ username: '', email: 'new@example.com' });
      const findUser = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(created);
      const deps = createDeps({ findUser });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status } = createReqRes({
        body: { ...validRegistration, username: '   ' },
      });

      await handlers.createUser(req, res);

      expect(findUser).toHaveBeenNthCalledWith(
        1,
        { $or: [{ email: 'new@example.com' }] },
        '_id email username',
      );
      expect(deps.registerUser).toHaveBeenCalledWith(
        expect.objectContaining({ username: '' }),
        expect.any(Object),
      );
      expect(status).toHaveBeenCalledWith(201);
    });

    it.each([
      {
        field: 'email',
        body: { ...validRegistration, username: '' },
        query: { $or: [{ email: 'new@example.com' }] },
      },
      {
        field: 'username',
        body: { ...validRegistration, email: '' },
        query: { $or: [{ username: 'new.user' }] },
      },
    ])('returns 409 for an existing $field', async ({ body, query }) => {
      const findUser = jest.fn().mockResolvedValue(mockUser());
      const deps = createDeps({ findUser });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ body });

      await handlers.createUser(req, res);

      expect(findUser).toHaveBeenCalledWith(query, '_id email username');
      expect(deps.registerUser).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(409);
      expect(json).toHaveBeenCalledWith({ error: 'Email or username already exists' });
    });

    it('maps registerUser validation failures to 400', async () => {
      const deps = createDeps({
        registerUser: jest.fn().mockResolvedValue({ status: 404, message: 'Invalid password' }),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        body: { ...validRegistration, password: 'short', confirmPassword: 'short' },
      });

      await handlers.createUser(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Invalid password' });
      expect(deps.findUser).toHaveBeenCalledTimes(1);
    });

    it('preserves non-validation failures returned by registerUser', async () => {
      const deps = createDeps({
        registerUser: jest.fn().mockResolvedValue({ status: 403, message: 'Domain not allowed' }),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ body: validRegistration });

      await handlers.createUser(req, res);

      expect(status).toHaveBeenCalledWith(403);
      expect(json).toHaveBeenCalledWith({ error: 'Domain not allowed' });
    });

    it('returns 409 when registration detects a concurrent email conflict', async () => {
      const deps = createDeps({
        registerUser: jest.fn().mockResolvedValue({
          status: 200,
          message: 'Please check your email',
          created: false,
        }),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ body: validRegistration });

      await handlers.createUser(req, res);

      expect(deps.findUser).toHaveBeenCalledTimes(1);
      expect(status).toHaveBeenCalledWith(409);
      expect(json).toHaveBeenCalledWith({ error: 'Email or username already exists' });
    });

    it('returns 500 when the created user cannot be retrieved', async () => {
      const handlers = createAdminUsersHandlers(createDeps());
      const { req, res, status, json } = createReqRes({ body: validRegistration });

      await handlers.createUser(req, res);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({ error: 'Failed to create user' });
    });

    it('returns a generic 500 response when a dependency throws', async () => {
      const deps = createDeps({ findUser: jest.fn().mockRejectedValue(new Error('db down')) });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ body: validRegistration });

      await handlers.createUser(req, res);

      expect(deps.registerUser).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({ error: 'Failed to create user' });
    });
  });

  describe('listUsers', () => {
    it('returns paginated users with total count', async () => {
      const users = [
        mockUser({ _id: new Types.ObjectId(validUserId) }),
        mockUser({ name: 'Other' }),
      ];
      const deps = createDeps({
        findUsers: jest.fn().mockResolvedValue(users),
        countUsers: jest.fn().mockResolvedValue(2),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes();

      await handlers.listUsers(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const response = json.mock.calls[0][0];
      expect(response.users).toHaveLength(2);
      expect(response.total).toBe(2);
      expect(response).toHaveProperty('limit');
      expect(response).toHaveProperty('offset');
      expect(response.users[0]).toHaveProperty('id');
      expect(response.users[0]).toHaveProperty('name');
      expect(response.users[0]).toHaveProperty('email');
      expect(response.users[0]).toHaveProperty('role');
    });

    it('passes pagination params to findUsers and unfiltered count', async () => {
      const findUsers = jest.fn().mockResolvedValue([]);
      const countUsers = jest.fn().mockResolvedValue(0);
      const deps = createDeps({ findUsers, countUsers });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res } = createReqRes({ query: { limit: '10', offset: '20' } });

      await handlers.listUsers(req, res);

      expect(findUsers).toHaveBeenCalledWith({}, expect.any(String), {
        limit: 10,
        offset: 20,
        sort: { createdAt: -1 },
      });
      expect(countUsers).toHaveBeenCalledWith();
    });

    it('returns empty list when no users', async () => {
      const deps = createDeps();
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes();

      await handlers.listUsers(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(json.mock.calls[0][0].users).toEqual([]);
      expect(json.mock.calls[0][0].total).toBe(0);
    });

    it('returns 500 when findUsers throws', async () => {
      const deps = createDeps({ findUsers: jest.fn().mockRejectedValue(new Error('db down')) });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes();

      await handlers.listUsers(req, res);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({ error: 'Failed to list users' });
    });

    it('returns 500 when countUsers throws', async () => {
      const deps = createDeps({
        countUsers: jest.fn().mockRejectedValue(new Error('count failed')),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes();

      await handlers.listUsers(req, res);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({ error: 'Failed to list users' });
    });
  });

  describe('searchUsers', () => {
    it('returns matching users with total and capped flag', async () => {
      const users = [mockUser()];
      const deps = createDeps({ findUsers: jest.fn().mockResolvedValue(users) });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ query: { q: 'test' } });

      await handlers.searchUsers(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const response = json.mock.calls[0][0];
      expect(response.users).toHaveLength(1);
      expect(response.total).toBe(1);
      expect(response.capped).toBe(false);
      expect(response.users[0]).toHaveProperty('id');
      expect(response.users[0]).toHaveProperty('name');
      expect(response.users[0]).toHaveProperty('email');
      expect(response.users[0]).toHaveProperty('username');
    });

    it('sets capped to true when results hit the limit', async () => {
      const users = Array.from({ length: 20 }, () => mockUser());
      const deps = createDeps({ findUsers: jest.fn().mockResolvedValue(users) });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, json } = createReqRes({ query: { q: 'test', limit: '20' } });

      await handlers.searchUsers(req, res);

      const response = json.mock.calls[0][0];
      expect(response.total).toBe(20);
      expect(response.capped).toBe(true);
    });

    it('searches name, email, and username with anchored prefix regex', async () => {
      const findUsers = jest.fn().mockResolvedValue([]);
      const deps = createDeps({ findUsers });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res } = createReqRes({ query: { q: 'test' } });

      await handlers.searchUsers(req, res);

      const filter = findUsers.mock.calls[0][0];
      expect(filter.$or).toHaveLength(3);
      expect(filter.$or[0]).toHaveProperty('name');
      expect(filter.$or[1]).toHaveProperty('email');
      expect(filter.$or[2]).toHaveProperty('username');
      expect(filter.$or[0].name.source).toBe('^test');
    });

    it('projects username in the field selection', async () => {
      const findUsers = jest.fn().mockResolvedValue([]);
      const deps = createDeps({ findUsers });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res } = createReqRes({ query: { q: 'test' } });

      await handlers.searchUsers(req, res);

      const projection = findUsers.mock.calls[0][1];
      expect(projection).toContain('username');
    });

    it('escapes regex special characters in query', async () => {
      const findUsers = jest.fn().mockResolvedValue([]);
      const deps = createDeps({ findUsers });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res } = createReqRes({ query: { q: 'test.user+1' } });

      await handlers.searchUsers(req, res);

      const filter = findUsers.mock.calls[0][0];
      expect(filter.$or[0].name).toBeInstanceOf(RegExp);
      expect(filter.$or[0].name.source).toBe('^test\\.user\\+1');
    });

    it('returns 400 when query is missing', async () => {
      const deps = createDeps();
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ query: {} });

      await handlers.searchUsers(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Query parameter "q" is required' });
    });

    it('returns 400 when query is empty string', async () => {
      const deps = createDeps();
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ query: { q: '' } });

      await handlers.searchUsers(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Query parameter "q" is required' });
    });

    it('returns 400 when query is whitespace-only', async () => {
      const deps = createDeps();
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ query: { q: '   ' } });

      await handlers.searchUsers(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Query parameter "q" is required' });
    });

    it('returns 400 when query is too short', async () => {
      const deps = createDeps();
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ query: { q: 'a' } });

      await handlers.searchUsers(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Query must be at least 2 characters' });
    });

    it('returns 400 when query exceeds max length', async () => {
      const deps = createDeps();
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ query: { q: 'a'.repeat(201) } });

      await handlers.searchUsers(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('200') }),
      );
    });

    it('treats array query param as missing', async () => {
      const deps = createDeps();
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ query: { q: ['foo', 'bar'] } });

      await handlers.searchUsers(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Query parameter "q" is required' });
    });

    it('passes limit to findUsers', async () => {
      const findUsers = jest.fn().mockResolvedValue([mockUser()]);
      const deps = createDeps({ findUsers });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res } = createReqRes({ query: { q: 'User', limit: '3' } });

      await handlers.searchUsers(req, res);

      expect(findUsers).toHaveBeenCalledWith(expect.any(Object), expect.any(String), {
        limit: 3,
        sort: { name: 1 },
      });
    });

    it('caps limit at 50', async () => {
      const findUsers = jest.fn().mockResolvedValue([]);
      const deps = createDeps({ findUsers });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res } = createReqRes({ query: { q: 'User', limit: '100' } });

      await handlers.searchUsers(req, res);

      expect(findUsers).toHaveBeenCalledWith(expect.any(Object), expect.any(String), {
        limit: 50,
        sort: { name: 1 },
      });
    });

    it('returns 500 on error', async () => {
      const deps = createDeps({ findUsers: jest.fn().mockRejectedValue(new Error('db down')) });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ query: { q: 'test' } });

      await handlers.searchUsers(req, res);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({ error: 'Failed to search users' });
    });
  });

  describe('deleteUser', () => {
    it('deletes user and returns 200', async () => {
      const result: UserDeleteResult = {
        deletedCount: 1,
        message: 'User was deleted successfully.',
      };
      const deps = createDeps({ deleteUserById: jest.fn().mockResolvedValue(result) });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ params: { id: validUserId } });

      await handlers.deleteUser(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ message: 'User was deleted successfully.' });
    });

    it('returns fallback message when result.message is empty', async () => {
      const result: UserDeleteResult = { deletedCount: 1, message: '' };
      const deps = createDeps({ deleteUserById: jest.fn().mockResolvedValue(result) });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ params: { id: validUserId } });

      await handlers.deleteUser(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ message: 'User deleted successfully' });
    });

    it('returns 403 when deleting own account', async () => {
      const userId = new Types.ObjectId();
      const deps = createDeps();
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: userId.toString() },
        user: { _id: userId, role: 'admin' },
      });

      await handlers.deleteUser(req, res);

      expect(status).toHaveBeenCalledWith(403);
      expect(json).toHaveBeenCalledWith({ error: 'Cannot delete your own account' });
      expect(deps.deleteUserById).not.toHaveBeenCalled();
    });

    it('returns 400 when deleting the last admin', async () => {
      const targetId = new Types.ObjectId().toString();
      const deps = createDeps({
        findUsers: jest.fn().mockResolvedValue([mockUser({ role: SystemRoles.ADMIN })]),
        countUsers: jest.fn().mockResolvedValue(1),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ params: { id: targetId } });

      await handlers.deleteUser(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Cannot delete the last admin user' });
      expect(deps.deleteUserById).not.toHaveBeenCalled();
      expect(deps.countUsers).toHaveBeenCalledWith({ role: SystemRoles.ADMIN });
    });

    it('allows deleting an admin when other admins exist', async () => {
      const targetId = new Types.ObjectId().toString();
      const deps = createDeps({
        findUsers: jest.fn().mockResolvedValue([mockUser({ role: SystemRoles.ADMIN })]),
        countUsers: jest.fn().mockResolvedValue(3),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status } = createReqRes({ params: { id: targetId } });

      await handlers.deleteUser(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.deleteUserById).toHaveBeenCalledWith(targetId);
    });

    it('does not check admin count when target is a regular user', async () => {
      const targetId = new Types.ObjectId().toString();
      const deps = createDeps({
        findUsers: jest.fn().mockResolvedValue([mockUser({ role: 'USER' })]),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status } = createReqRes({ params: { id: targetId } });

      await handlers.deleteUser(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.countUsers).not.toHaveBeenCalled();
    });

    it('cascades cleanup of Config and AclEntries', async () => {
      const result: UserDeleteResult = {
        deletedCount: 1,
        message: 'User was deleted successfully.',
      };
      const deps = createDeps({ deleteUserById: jest.fn().mockResolvedValue(result) });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status } = createReqRes({ params: { id: validUserId } });

      await handlers.deleteUser(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.deleteConfig).toHaveBeenCalledWith(PrincipalType.USER, validUserId);
      expect(deps.deleteAclEntries).toHaveBeenCalledWith({
        principalType: PrincipalType.USER,
        principalId: expect.any(Types.ObjectId),
      });
    });

    it('returns success even when cascade cleanup partially fails', async () => {
      const result: UserDeleteResult = {
        deletedCount: 1,
        message: 'User was deleted successfully.',
      };
      const deps = createDeps({
        deleteUserById: jest.fn().mockResolvedValue(result),
        deleteConfig: jest.fn().mockRejectedValue(new Error('cleanup failed')),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ params: { id: validUserId } });

      await handlers.deleteUser(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ message: 'User was deleted successfully.' });
    });

    it('does not cascade when user is not found', async () => {
      const result: UserDeleteResult = { deletedCount: 0, message: '' };
      const deps = createDeps({ deleteUserById: jest.fn().mockResolvedValue(result) });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status } = createReqRes({ params: { id: validUserId } });

      await handlers.deleteUser(req, res);

      expect(status).toHaveBeenCalledWith(404);
      expect(deps.deleteConfig).not.toHaveBeenCalled();
      expect(deps.deleteAclEntries).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid ObjectId', async () => {
      const deps = createDeps();
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ params: { id: 'not-valid' } });

      await handlers.deleteUser(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Invalid user ID format' });
    });

    it('returns 404 when user not found', async () => {
      const result: UserDeleteResult = { deletedCount: 0, message: '' };
      const deps = createDeps({ deleteUserById: jest.fn().mockResolvedValue(result) });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ params: { id: validUserId } });

      await handlers.deleteUser(req, res);

      expect(status).toHaveBeenCalledWith(404);
      expect(json).toHaveBeenCalledWith({ error: 'User not found' });
    });

    it('returns 500 on error', async () => {
      const deps = createDeps({
        deleteUserById: jest.fn().mockRejectedValue(new Error('db crash')),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ params: { id: validUserId } });

      await handlers.deleteUser(req, res);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({ error: 'Failed to delete user' });
    });

    it('cascades deletion of the user conversations and messages', async () => {
      const deps = createDeps({
        findUsers: jest.fn().mockResolvedValue([mockUser({ role: SystemRoles.USER })]),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status } = createReqRes({ params: { id: validUserId } });

      await handlers.deleteUser(req, res);

      expect(deps.deleteMessages).toHaveBeenCalledWith({ user: validUserId });
      expect(deps.deleteConvos).toHaveBeenCalledWith(validUserId, {});
      expect(status).toHaveBeenCalledWith(200);
    });

    it('still succeeds when the user has no conversations to delete', async () => {
      const deps = createDeps({
        findUsers: jest.fn().mockResolvedValue([mockUser({ role: SystemRoles.USER })]),
        deleteConvos: jest.fn().mockRejectedValue(new Error('Conversation not found')),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status } = createReqRes({ params: { id: validUserId } });

      await handlers.deleteUser(req, res);

      expect(status).toHaveBeenCalledWith(200);
    });
  });

  describe('updateUserName', () => {
    it('trims and updates the display name, returning the safe user shape', async () => {
      const updated = mockUser({ name: 'Updated Name' });
      const deps = createDeps({ updateUser: jest.fn().mockResolvedValue(updated) });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: validUserId },
        body: { name: '  Updated Name  ' },
      });

      await handlers.updateUserName(req, res);

      expect(deps.updateUser).toHaveBeenCalledWith(validUserId, { name: 'Updated Name' });
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({
        user: expect.objectContaining({ name: 'Updated Name', email: updated.email }),
      });
      expect(json.mock.calls[0][0].user).not.toHaveProperty('password');
    });

    it('rejects an invalid user ID', async () => {
      const deps = createDeps();
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: 'not-an-object-id' },
        body: { name: 'Updated Name' },
      });

      await handlers.updateUserName(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Invalid user ID format' });
      expect(deps.updateUser).not.toHaveBeenCalled();
    });

    it.each([undefined, null, 123, true])('rejects non-string name %p', async (name) => {
      const deps = createDeps();
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: validUserId },
        body: { name },
      });

      await handlers.updateUserName(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'name must be a string' });
      expect(deps.updateUser).not.toHaveBeenCalled();
    });

    it.each(['', '  ', 'ab', 'a'.repeat(81)])('rejects invalid name length', async (name) => {
      const deps = createDeps();
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: validUserId },
        body: { name },
      });

      await handlers.updateUserName(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({
        error: 'name must be between 3 and 80 characters',
      });
      expect(deps.updateUser).not.toHaveBeenCalled();
    });

    it('returns 404 when the user does not exist', async () => {
      const deps = createDeps({ updateUser: jest.fn().mockResolvedValue(null) });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: validUserId },
        body: { name: 'Updated Name' },
      });

      await handlers.updateUserName(req, res);

      expect(status).toHaveBeenCalledWith(404);
      expect(json).toHaveBeenCalledWith({ error: 'User not found' });
    });

    it('returns 500 when the update fails', async () => {
      const deps = createDeps({
        updateUser: jest.fn().mockRejectedValue(new Error('db down')),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: validUserId },
        body: { name: 'Updated Name' },
      });

      await handlers.updateUserName(req, res);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({ error: 'Failed to update user name' });
    });
  });

  describe('updateUserPassword', () => {
    it('hashes the new password, updates the user, and revokes existing sessions', async () => {
      const hashPassword = jest.fn().mockResolvedValue('secure-password-hash');
      const deps = createDeps({ hashPassword });
      const handlers = createAdminUsersHandlers(deps);
      const password = '  Password123!  ';
      const { req, res, status, json } = createReqRes({
        params: { id: validUserId },
        body: { password },
      });

      await handlers.updateUserPassword(req, res);

      expect(hashPassword).toHaveBeenCalledWith(password);
      expect(deps.updateUser).toHaveBeenCalledWith(validUserId, {
        password: 'secure-password-hash',
      });
      expect(deps.deleteAllUserSessions).toHaveBeenCalledWith(validUserId);
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ message: 'Password updated successfully' });
    });

    it.each([
      [undefined, 'password must be a string'],
      [123, 'password must be a string'],
      ['short', 'password must be between 8 and 128 characters'],
      [' '.repeat(8), 'password cannot contain only spaces'],
      ['a'.repeat(129), 'password must be between 8 and 128 characters'],
    ])('rejects invalid password %p', async (password, error) => {
      const deps = createDeps();
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: validUserId },
        body: { password },
      });

      await handlers.updateUserPassword(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error });
      expect(deps.hashPassword).not.toHaveBeenCalled();
      expect(deps.updateUser).not.toHaveBeenCalled();
    });

    it('uses the configured minimum password length', async () => {
      const deps = createDeps({ minPasswordLength: 12 });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: validUserId },
        body: { password: 'Password1!' },
      });

      await handlers.updateUserPassword(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({
        error: 'password must be between 12 and 128 characters',
      });
    });

    it('returns 404 without revoking sessions when the user does not exist', async () => {
      const deps = createDeps({ updateUser: jest.fn().mockResolvedValue(null) });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: validUserId },
        body: { password: 'Password123!' },
      });

      await handlers.updateUserPassword(req, res);

      expect(status).toHaveBeenCalledWith(404);
      expect(json).toHaveBeenCalledWith({ error: 'User not found' });
      expect(deps.deleteAllUserSessions).not.toHaveBeenCalled();
    });

    it('keeps the password update successful when session revocation fails', async () => {
      const deps = createDeps({
        deleteAllUserSessions: jest.fn().mockRejectedValue(new Error('session store down')),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: validUserId },
        body: { password: 'Password123!' },
      });

      await handlers.updateUserPassword(req, res);

      expect(status).toHaveBeenCalledWith(200);
    });
  });

  describe('updateUserRole', () => {
    it('promotes a regular user to admin', async () => {
      const deps = createDeps({
        findUsers: jest.fn().mockResolvedValue([mockUser({ role: SystemRoles.USER })]),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: validUserId },
        body: { role: SystemRoles.ADMIN },
      });

      await handlers.updateUserRole(req, res);

      expect(deps.updateUser).toHaveBeenCalledWith(validUserId, { role: SystemRoles.ADMIN });
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({
        message: 'Role updated successfully',
        role: SystemRoles.ADMIN,
      });
    });

    it('rejects an unknown role', async () => {
      const handlers = createAdminUsersHandlers(createDeps());
      const { req, res, status, json } = createReqRes({
        params: { id: validUserId },
        body: { role: 'SUPERUSER' },
      });

      await handlers.updateUserRole(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Role must be one of: USER, ADMIN' });
    });

    it('refuses to demote your own account', async () => {
      const callerId = new Types.ObjectId();
      const handlers = createAdminUsersHandlers(createDeps());
      const { req, res, status, json } = createReqRes({
        params: { id: callerId.toString() },
        body: { role: SystemRoles.USER },
        user: { _id: callerId, role: 'admin' },
      });

      await handlers.updateUserRole(req, res);

      expect(status).toHaveBeenCalledWith(403);
      expect(json).toHaveBeenCalledWith({ error: 'Cannot demote your own account' });
    });

    it('refuses to demote the last admin', async () => {
      const deps = createDeps({
        findUsers: jest.fn().mockResolvedValue([mockUser({ role: SystemRoles.ADMIN })]),
        countUsers: jest.fn().mockResolvedValue(1),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: validUserId },
        body: { role: SystemRoles.USER },
      });

      await handlers.updateUserRole(req, res);

      expect(deps.updateUser).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Cannot demote the last admin user' });
    });

    it('demotes an admin when other admins remain', async () => {
      const deps = createDeps({
        findUsers: jest.fn().mockResolvedValue([mockUser({ role: SystemRoles.ADMIN })]),
        countUsers: jest.fn().mockResolvedValue(2),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: validUserId },
        body: { role: SystemRoles.USER },
      });

      await handlers.updateUserRole(req, res);

      expect(deps.updateUser).toHaveBeenCalledWith(validUserId, { role: SystemRoles.USER });
      expect(status).toHaveBeenCalledWith(200);
    });

    it('returns 404 when the target user does not exist', async () => {
      const deps = createDeps({ findUsers: jest.fn().mockResolvedValue([]) });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: validUserId },
        body: { role: SystemRoles.ADMIN },
      });

      await handlers.updateUserRole(req, res);

      expect(status).toHaveBeenCalledWith(404);
      expect(json).toHaveBeenCalledWith({ error: 'User not found' });
    });

    it('is a no-op when the role is unchanged', async () => {
      const deps = createDeps({
        findUsers: jest.fn().mockResolvedValue([mockUser({ role: SystemRoles.ADMIN })]),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: validUserId },
        body: { role: SystemRoles.ADMIN },
      });

      await handlers.updateUserRole(req, res);

      expect(deps.updateUser).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ message: 'Role unchanged', role: SystemRoles.ADMIN });
    });

    it('returns 400 for an invalid ObjectId', async () => {
      const handlers = createAdminUsersHandlers(createDeps());
      const { req, res, status, json } = createReqRes({
        params: { id: 'not-an-id' },
        body: { role: SystemRoles.ADMIN },
      });

      await handlers.updateUserRole(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Invalid user ID format' });
    });
  });

  describe('updateUserStatus', () => {
    it('disables a member and revokes all of their sessions', async () => {
      const target = mockUser({ _id: new Types.ObjectId(validUserId), isDisabled: false });
      const updated = mockUser({ ...target, isDisabled: true });
      const deps = createDeps({
        findUsers: jest.fn().mockResolvedValue([target]),
        updateUser: jest.fn().mockResolvedValue(updated),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: validUserId },
        body: { disabled: true },
      });

      await handlers.updateUserStatus(req, res);

      expect(deps.updateUser).toHaveBeenCalledWith(validUserId, { isDisabled: true });
      expect(deps.deleteAllUserSessions).toHaveBeenCalledWith(validUserId);
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({
        user: expect.objectContaining({ id: validUserId, isDisabled: true }),
      });
    });

    it('enables a member without revoking sessions', async () => {
      const target = mockUser({ _id: new Types.ObjectId(validUserId), isDisabled: true });
      const deps = createDeps({
        findUsers: jest.fn().mockResolvedValue([target]),
        updateUser: jest.fn().mockResolvedValue(mockUser({ ...target, isDisabled: false })),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: validUserId },
        body: { disabled: false },
      });

      await handlers.updateUserStatus(req, res);

      expect(deps.updateUser).toHaveBeenCalledWith(validUserId, { isDisabled: false });
      expect(deps.deleteAllUserSessions).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(200);
    });

    it('refuses to disable the caller or the last active admin', async () => {
      const callerId = new Types.ObjectId();
      const handlers = createAdminUsersHandlers(createDeps());
      const self = createReqRes({
        params: { id: callerId.toString() },
        body: { disabled: true },
        user: { _id: callerId, role: SystemRoles.ADMIN },
      });
      await handlers.updateUserStatus(self.req, self.res);
      expect(self.status).toHaveBeenCalledWith(403);

      const deps = createDeps({
        findUsers: jest.fn().mockResolvedValue([mockUser({ role: SystemRoles.ADMIN })]),
        countUsers: jest.fn().mockResolvedValue(1),
      });
      const lastAdmin = createReqRes({
        params: { id: validUserId },
        body: { disabled: true },
      });
      await createAdminUsersHandlers(deps).updateUserStatus(lastAdmin.req, lastAdmin.res);
      expect(lastAdmin.status).toHaveBeenCalledWith(400);
      expect(deps.updateUser).not.toHaveBeenCalled();
    });
  });

  describe('user image-agent models', () => {
    it('returns inherited and effective model lists', async () => {
      const deps = createDeps({
        findUsers: jest
          .fn()
          .mockResolvedValue([
            mockUser({ _id: new Types.ObjectId(validUserId), allowedAgentModels: undefined }),
          ]),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ params: { id: validUserId } });

      await handlers.getUserAgentModels(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({
        agentId: 'agent-image',
        availableModels: ['gpt-image-a', 'gpt-image-b', ...addedImageModels],
        allowedModels: null,
        effectiveModels: ['gpt-image-a', 'gpt-image-b', ...addedImageModels],
      });
    });

    it('persists a normalized subset and supports an explicit deny-all list', async () => {
      const target = mockUser({ _id: new Types.ObjectId(validUserId) });
      const updateUserAgentModels = jest
        .fn()
        .mockResolvedValueOnce(mockUser({ ...target, allowedAgentModels: ['gpt-image-b'] }))
        .mockResolvedValueOnce(mockUser({ ...target, allowedAgentModels: [] }));
      const deps = createDeps({
        findUsers: jest.fn().mockResolvedValue([target]),
        updateUserAgentModels,
      });
      const handlers = createAdminUsersHandlers(deps);

      const subset = createReqRes({
        params: { id: validUserId },
        body: { allowedModels: [' gpt-image-b ', 'gpt-image-b'] },
      });
      await handlers.updateUserAgentModels(subset.req, subset.res);
      expect(updateUserAgentModels).toHaveBeenNthCalledWith(1, validUserId, ['gpt-image-b']);
      expect(subset.status).toHaveBeenCalledWith(200);

      const denyAll = createReqRes({
        params: { id: validUserId },
        body: { allowedModels: [] },
      });
      await handlers.updateUserAgentModels(denyAll.req, denyAll.res);
      expect(updateUserAgentModels).toHaveBeenNthCalledWith(2, validUserId, []);
      expect(denyAll.json).toHaveBeenCalledWith(
        expect.objectContaining({ allowedModels: [], effectiveModels: [] }),
      );
    });

    it('rejects model IDs outside the image Agent provider list', async () => {
      const deps = createDeps({
        findUsers: jest.fn().mockResolvedValue([mockUser()]),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: validUserId },
        body: { allowedModels: ['gpt-image-unknown'] },
      });

      await handlers.updateUserAgentModels(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({
        error: 'allowedModels contains unavailable models',
        unavailableModels: ['gpt-image-unknown'],
      });
      expect(deps.updateUserAgentModels).not.toHaveBeenCalled();
    });
  });
});
