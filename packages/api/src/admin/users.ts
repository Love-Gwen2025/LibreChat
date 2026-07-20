import { Types } from 'mongoose';
import { EModelEndpoint, PrincipalType, SystemRoles } from 'librechat-data-provider';
import { logger, isValidObjectIdString } from '@librechat/data-schemas';
import type {
  IUser,
  IAgent,
  IConfig,
  IMessage,
  IConversation,
  AdminUserListItem,
  AdminUserSearchResult,
  UserDeleteResult,
} from '@librechat/data-schemas';
import type { FilterQuery } from 'mongoose';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { parsePagination } from './pagination';
import {
  getBuiltinImageAgentId,
  getBuiltinImageAgentModels,
  getEffectiveAgentModels,
  normalizeAgentModels,
} from '~/agents/imageAgent';

const MAX_SEARCH_LENGTH = 200;
const MIN_USER_NAME_LENGTH = 3;
const MAX_USER_NAME_LENGTH = 80;

const USER_LIST_FIELDS =
  '_id name username email avatar role provider isDisabled allowedAgentModels createdAt updatedAt';

type RegisterUserResult = {
  status: number;
  message: string;
  created?: boolean;
};

function mapUserListItem(user: IUser): AdminUserListItem {
  return {
    id: user._id?.toString() ?? '',
    name: user.name ?? '',
    username: user.username ?? '',
    email: user.email ?? '',
    avatar: user.avatar ?? '',
    role: user.role ?? SystemRoles.USER,
    provider: user.provider ?? 'local',
    isDisabled: user.isDisabled === true,
    ...(user.allowedAgentModels !== undefined && {
      allowedAgentModels: normalizeAgentModels(user.allowedAgentModels),
    }),
    createdAt: user.createdAt?.toISOString(),
    updatedAt: user.updatedAt?.toISOString(),
  };
}

function normalizeText(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function normalizeIdentity(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export interface AdminUsersDeps {
  findUser: (
    searchCriteria: FilterQuery<IUser>,
    fieldsToSelect?: string | string[] | null,
  ) => Promise<IUser | null>;
  findUsers: (
    searchCriteria: FilterQuery<IUser>,
    fieldsToSelect?: string | string[] | null,
    options?: { limit?: number; offset?: number; sort?: Record<string, 1 | -1> },
  ) => Promise<IUser[]>;
  countUsers: (filter?: FilterQuery<IUser>) => Promise<number>;
  /**
   * Thin data-layer delete — removes the User document only.
   * This admin endpoint cascades Config, AclEntries, conversations, and messages.
   * Files, tokens, and plugin auth remain exclusive to the self-delete flow in
   * `UserController.deleteUserController`.
   */
  deleteUserById: (userId: string) => Promise<UserDeleteResult>;
  deleteConfig: (
    principalType: PrincipalType,
    principalId: string | Types.ObjectId,
  ) => Promise<IConfig | null>;
  deleteAclEntries: (filter: {
    principalType: PrincipalType;
    principalId: string | Types.ObjectId;
  }) => Promise<void>;
  updateUser: (userId: string, updateData: Partial<IUser>) => Promise<IUser | null>;
  updateUserAgentModels: (userId: string, models: string[] | null) => Promise<IUser | null>;
  deleteAllUserSessions: (userId: string) => Promise<{ deletedCount?: number }>;
  getAgent: (searchCriteria: FilterQuery<IAgent>) => Promise<IAgent | null>;
  getModelsConfig: (req: ServerRequest) => Promise<Record<string, unknown>>;
  /** Removes the user's conversations and their messages. Throws when the user has none. */
  deleteConvos: (user: string, filter: FilterQuery<IConversation>) => Promise<unknown>;
  deleteMessages: (filter: FilterQuery<IMessage>) => Promise<unknown>;
  registerUser: (
    user: Record<string, unknown>,
    additionalData?: Partial<IUser>,
  ) => Promise<RegisterUserResult>;
}

const ASSIGNABLE_ROLES: ReadonlySet<string> = new Set([SystemRoles.USER, SystemRoles.ADMIN]);

export function createAdminUsersHandlers(deps: AdminUsersDeps): {
  createUser: (req: ServerRequest, res: Response) => Promise<Response>;
  listUsers: (req: ServerRequest, res: Response) => Promise<Response>;
  searchUsers: (req: ServerRequest, res: Response) => Promise<Response>;
  deleteUser: (req: ServerRequest, res: Response) => Promise<Response>;
  updateUserName: (req: ServerRequest, res: Response) => Promise<Response>;
  updateUserRole: (req: ServerRequest, res: Response) => Promise<Response>;
  updateUserStatus: (req: ServerRequest, res: Response) => Promise<Response>;
  getUserAgentModels: (req: ServerRequest, res: Response) => Promise<Response>;
  updateUserAgentModels: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  const {
    findUser,
    findUsers,
    countUsers,
    deleteUserById,
    deleteConfig,
    deleteAclEntries,
    updateUser,
    updateUserAgentModels,
    deleteAllUserSessions,
    getAgent,
    getModelsConfig,
    deleteConvos,
    deleteMessages,
    registerUser,
  } = deps;

  /** Mirrors the self-delete cascade order: messages first, then conversations. */
  async function deleteConversationAssets(userId: string) {
    await deleteMessages({ user: userId });
    try {
      await deleteConvos(userId, {});
    } catch (error) {
      logger.debug('[adminUsers] no conversations to delete for user:', userId, error);
    }
  }

  async function listUsersHandler(req: ServerRequest, res: Response) {
    try {
      const { limit, offset } = parsePagination(req.query);
      const [users, total] = await Promise.all([
        findUsers({}, USER_LIST_FIELDS, { limit, offset, sort: { createdAt: -1 } }),
        countUsers(),
      ]);

      const mapped = users.map(mapUserListItem);

      return res.status(200).json({ users: mapped, total, limit, offset });
    } catch (error) {
      logger.error('[adminUsers] listUsers error:', error);
      return res.status(500).json({ error: 'Failed to list users' });
    }
  }

  async function createUserHandler(req: ServerRequest, res: Response) {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const email = normalizeIdentity(body.email);
      const username = normalizeIdentity(body.username);
      const registration = {
        name: normalizeText(body.name),
        username,
        email,
        password: body.password,
        confirm_password: body.confirmPassword,
      };

      const conflicts: FilterQuery<IUser>[] = [];
      if (typeof email === 'string' && email.length > 0) {
        conflicts.push({ email });
      }
      if (typeof username === 'string' && username.length > 0) {
        conflicts.push({ username });
      }

      if (conflicts.length > 0) {
        const existing = await findUser({ $or: conflicts }, '_id email username');
        if (existing) {
          return res.status(409).json({ error: 'Email or username already exists' });
        }
      }

      const result = await registerUser(registration, {
        role: SystemRoles.USER,
        emailVerified: true,
      });
      if (result.status !== 200) {
        const status = result.status === 404 ? 400 : result.status;
        return res.status(status).json({ error: result.message });
      }
      if (result.created === false) {
        return res.status(409).json({ error: 'Email or username already exists' });
      }

      if (typeof email !== 'string') {
        logger.error('[adminUsers] registerUser succeeded without a normalized email');
        return res.status(500).json({ error: 'Failed to create user' });
      }

      const created = await findUser({ email }, USER_LIST_FIELDS);
      if (!created) {
        logger.error('[adminUsers] created user could not be retrieved');
        return res.status(500).json({ error: 'Failed to create user' });
      }

      return res.status(201).json({ user: mapUserListItem(created) });
    } catch (error) {
      logger.error('[adminUsers] createUser error:', error);
      return res.status(500).json({ error: 'Failed to create user' });
    }
  }

  async function searchUsersHandler(req: ServerRequest, res: Response) {
    try {
      const rawQ = req.query.q;
      const rawLimit = req.query.limit;
      const query = typeof rawQ === 'string' ? rawQ : undefined;
      const limitStr = typeof rawLimit === 'string' ? rawLimit : '20';
      const trimmed = query?.trim() ?? '';

      if (!trimmed) {
        return res.status(400).json({ error: 'Query parameter "q" is required' });
      }

      if (trimmed.length < 2) {
        return res.status(400).json({ error: 'Query must be at least 2 characters' });
      }

      if (trimmed.length > MAX_SEARCH_LENGTH) {
        return res
          .status(400)
          .json({ error: `Query must not exceed ${MAX_SEARCH_LENGTH} characters` });
      }

      const searchLimit = Math.min(Math.max(1, parseInt(limitStr, 10) || 20), 50);
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`^${escaped}`, 'i');

      const users = await findUsers(
        { $or: [{ name: regex }, { email: regex }, { username: regex }] },
        '_id name email username avatar',
        { limit: searchLimit, sort: { name: 1 } },
      );

      const results: AdminUserSearchResult[] = users.map((u) => ({
        id: u._id?.toString() ?? '',
        name: u.name ?? '',
        email: u.email ?? '',
        username: u.username,
        avatarUrl: u.avatar,
      }));

      return res
        .status(200)
        .json({ users: results, total: results.length, capped: results.length >= searchLimit });
    } catch (error) {
      logger.error('[adminUsers] searchUsers error:', error);
      return res.status(500).json({ error: 'Failed to search users' });
    }
  }

  async function deleteUserHandler(req: ServerRequest, res: Response) {
    try {
      const { id } = req.params as { id: string };

      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      const callerId = req.user?._id?.toString() ?? req.user?.id;
      if (callerId === id) {
        return res.status(403).json({ error: 'Cannot delete your own account' });
      }

      const [targetUser] = await findUsers({ _id: id }, 'role', { limit: 1 });
      if (targetUser?.role === SystemRoles.ADMIN) {
        const adminCount = await countUsers({ role: SystemRoles.ADMIN });
        if (adminCount <= 1) {
          return res.status(400).json({ error: 'Cannot delete the last admin user' });
        }
      }

      const result = await deleteUserById(id);

      if (result.deletedCount === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (targetUser?.role === SystemRoles.ADMIN) {
        const remaining = await countUsers({ role: SystemRoles.ADMIN });
        if (remaining === 0) {
          logger.error(
            `[adminUsers] CRITICAL: last admin deleted via race condition, user: ${id}. ` +
              'Manual DB intervention required to restore an ADMIN user.',
          );
        }
      }

      const objectId = new Types.ObjectId(id);
      const cleanupResults = await Promise.allSettled([
        deleteConfig(PrincipalType.USER, id),
        deleteAclEntries({ principalType: PrincipalType.USER, principalId: objectId }),
        deleteConversationAssets(id),
      ]);
      for (const r of cleanupResults) {
        if (r.status === 'rejected') {
          logger.error('[adminUsers] cascade cleanup failed for user:', id, r.reason);
        }
      }

      return res.status(200).json({ message: result.message || 'User deleted successfully' });
    } catch (error) {
      logger.error('[adminUsers] deleteUser error:', error);
      return res.status(500).json({ error: 'Failed to delete user' });
    }
  }

  async function updateUserNameHandler(req: ServerRequest, res: Response) {
    try {
      const { id } = req.params as { id: string };
      const rawName = (req.body as { name?: unknown }).name;

      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }
      if (typeof rawName !== 'string') {
        return res.status(400).json({ error: 'name must be a string' });
      }

      const name = rawName.trim();
      if (name.length < MIN_USER_NAME_LENGTH || name.length > MAX_USER_NAME_LENGTH) {
        return res.status(400).json({
          error: `name must be between ${MIN_USER_NAME_LENGTH} and ${MAX_USER_NAME_LENGTH} characters`,
        });
      }

      const updated = await updateUser(id, { name });
      if (!updated) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.status(200).json({ user: mapUserListItem(updated) });
    } catch (error) {
      logger.error('[adminUsers] updateUserName error:', error);
      return res.status(500).json({ error: 'Failed to update user name' });
    }
  }

  async function updateUserRoleHandler(req: ServerRequest, res: Response) {
    try {
      const { id } = req.params as { id: string };
      const { role } = req.body as { role?: string };

      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      if (!role || !ASSIGNABLE_ROLES.has(role)) {
        return res.status(400).json({ error: 'Role must be one of: USER, ADMIN' });
      }

      const callerId = req.user?._id?.toString() ?? req.user?.id;
      if (callerId === id && role !== SystemRoles.ADMIN) {
        return res.status(403).json({ error: 'Cannot demote your own account' });
      }

      const [targetUser] = await findUsers({ _id: id }, 'role', { limit: 1 });
      if (!targetUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (targetUser.role === role) {
        return res.status(200).json({ message: 'Role unchanged', role });
      }

      if (targetUser.role === SystemRoles.ADMIN && role !== SystemRoles.ADMIN) {
        const adminCount = await countUsers({ role: SystemRoles.ADMIN });
        if (adminCount <= 1) {
          return res.status(400).json({ error: 'Cannot demote the last admin user' });
        }
      }

      const updated = await updateUser(id, { role });
      if (!updated) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.status(200).json({ message: 'Role updated successfully', role });
    } catch (error) {
      logger.error('[adminUsers] updateUserRole error:', error);
      return res.status(500).json({ error: 'Failed to update user role' });
    }
  }

  async function updateUserStatusHandler(req: ServerRequest, res: Response) {
    try {
      const { id } = req.params as { id: string };
      const { disabled } = req.body as { disabled?: unknown };

      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }
      if (typeof disabled !== 'boolean') {
        return res.status(400).json({ error: 'disabled must be a boolean' });
      }

      const callerId = req.user?._id?.toString() ?? req.user?.id;
      if (disabled && callerId === id) {
        return res.status(403).json({ error: 'Cannot disable your own account' });
      }

      const [targetUser] = await findUsers(
        { _id: id },
        '_id name username email avatar role provider isDisabled allowedAgentModels createdAt updatedAt',
        { limit: 1 },
      );
      if (!targetUser) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (targetUser.isDisabled === disabled) {
        return res.status(200).json({ user: mapUserListItem(targetUser) });
      }

      if (disabled && targetUser.role === SystemRoles.ADMIN) {
        const activeAdminCount = await countUsers({
          role: SystemRoles.ADMIN,
          isDisabled: { $ne: true },
        });
        if (activeAdminCount <= 1) {
          return res.status(400).json({ error: 'Cannot disable the last active admin user' });
        }
      }

      const updated = await updateUser(id, { isDisabled: disabled });
      if (!updated) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (disabled) {
        try {
          await deleteAllUserSessions(id);
        } catch (error) {
          logger.error('[adminUsers] failed to revoke disabled user sessions:', id, error);
        }
      }

      return res.status(200).json({ user: mapUserListItem(updated) });
    } catch (error) {
      logger.error('[adminUsers] updateUserStatus error:', error);
      return res.status(500).json({ error: 'Failed to update user status' });
    }
  }

  async function resolveUserAgentModels(req: ServerRequest, userId: string) {
    const [user] = await findUsers({ _id: userId }, '_id allowedAgentModels', { limit: 1 });
    if (!user) {
      return { error: 'User not found' as const, status: 404 as const };
    }

    const agentId = getBuiltinImageAgentId(req.config);
    if (!agentId) {
      return { error: 'Built-in image Agent is not configured' as const, status: 503 as const };
    }

    const agent = await getAgent({ id: agentId });
    if (!agent) {
      return { error: 'Built-in image Agent was not found' as const, status: 503 as const };
    }

    let availableModels = getBuiltinImageAgentModels(agent.allowed_models);
    const modelsConfig = await getModelsConfig(req);
    const providerKey =
      agent.provider.toLowerCase() === 'openai' ? EModelEndpoint.openAI : agent.provider;
    const providerModels = normalizeAgentModels(modelsConfig[providerKey]);
    if (providerModels.length > 0) {
      const providerSet = new Set(providerModels);
      availableModels = availableModels.filter((model) => providerSet.has(model));
    }

    return {
      user,
      agentId,
      availableModels,
      allowedModels:
        user.allowedAgentModels === undefined
          ? null
          : normalizeAgentModels(user.allowedAgentModels),
    };
  }

  async function getUserAgentModelsHandler(req: ServerRequest, res: Response) {
    try {
      const { id } = req.params as { id: string };
      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      const resolved = await resolveUserAgentModels(req, id);
      if ('error' in resolved) {
        return res.status(resolved.status).json({ error: resolved.error });
      }

      return res.status(200).json({
        agentId: resolved.agentId,
        availableModels: resolved.availableModels,
        allowedModels: resolved.allowedModels,
        effectiveModels: getEffectiveAgentModels(resolved.availableModels, resolved.allowedModels),
      });
    } catch (error) {
      logger.error('[adminUsers] getUserAgentModels error:', error);
      return res.status(500).json({ error: 'Failed to load user models' });
    }
  }

  async function updateUserAgentModelsHandler(req: ServerRequest, res: Response) {
    try {
      const { id } = req.params as { id: string };
      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      const rawAllowedModels = (req.body as { allowedModels?: unknown }).allowedModels;
      if (rawAllowedModels !== null && !Array.isArray(rawAllowedModels)) {
        return res.status(400).json({ error: 'allowedModels must be an array or null' });
      }
      if (
        Array.isArray(rawAllowedModels) &&
        rawAllowedModels.some(
          (model) => typeof model !== 'string' || model.trim().length === 0 || model.length > 256,
        )
      ) {
        return res.status(400).json({ error: 'allowedModels contains an invalid model ID' });
      }

      const resolved = await resolveUserAgentModels(req, id);
      if ('error' in resolved) {
        return res.status(resolved.status).json({ error: resolved.error });
      }

      const allowedModels =
        rawAllowedModels === null ? null : normalizeAgentModels(rawAllowedModels);
      if (allowedModels && allowedModels.length > 100) {
        return res.status(400).json({ error: 'No more than 100 models may be assigned' });
      }
      const availableSet = new Set(resolved.availableModels);
      const unavailableModels = allowedModels?.filter((model) => !availableSet.has(model)) ?? [];
      if (unavailableModels.length > 0) {
        return res.status(400).json({
          error: 'allowedModels contains unavailable models',
          unavailableModels,
        });
      }

      const updated = await updateUserAgentModels(id, allowedModels);
      if (!updated) {
        return res.status(404).json({ error: 'User not found' });
      }

      const savedModels =
        updated.allowedAgentModels === undefined
          ? null
          : normalizeAgentModels(updated.allowedAgentModels);
      return res.status(200).json({
        agentId: resolved.agentId,
        availableModels: resolved.availableModels,
        allowedModels: savedModels,
        effectiveModels: getEffectiveAgentModels(resolved.availableModels, savedModels),
      });
    } catch (error) {
      logger.error('[adminUsers] updateUserAgentModels error:', error);
      return res.status(500).json({ error: 'Failed to update user models' });
    }
  }

  return {
    createUser: createUserHandler,
    listUsers: listUsersHandler,
    searchUsers: searchUsersHandler,
    deleteUser: deleteUserHandler,
    updateUserName: updateUserNameHandler,
    updateUserRole: updateUserRoleHandler,
    updateUserStatus: updateUserStatusHandler,
    getUserAgentModels: getUserAgentModelsHandler,
    updateUserAgentModels: updateUserAgentModelsHandler,
  };
}
