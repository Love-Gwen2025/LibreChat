const { logger, getTenantId, webSearchKeys } = require('@librechat/data-schemas');
const {
  getNewS3URL,
  needsRefresh,
  MCPOAuthHandler,
  MCPTokenStorage,
  normalizeHttpError,
  extractWebSearchEnvVars,
} = require('@librechat/api');
const { Tools, CacheKeys, Constants, FileSources } = require('librechat-data-provider');
const { updateUserPluginAuth, deleteUserPluginAuth } = require('~/server/services/PluginService');
const { verifyEmail, resendVerificationEmail } = require('~/server/services/AuthService');
const { getMCPManager, getFlowStateManager, getMCPServersRegistry } = require('~/config');
const { invalidateCachedTools } = require('~/server/services/Config/getCachedTools');
const { getAppConfig } = require('~/server/services/Config');
const { getLogStores } = require('~/cache');
const db = require('~/models');

const PUBLIC_USER_RESPONSE_FIELDS = [
  '_id',
  'id',
  'name',
  'username',
  'email',
  'emailVerified',
  'avatar',
  'provider',
  'role',
  'plugins',
  'twoFactorEnabled',
  'termsAccepted',
  'personalization',
  'favorites',
  'skillStates',
  'createdAt',
  'updatedAt',
  'tenantId',
];

const sanitizeUserForResponse = (user) => {
  const source = user.toObject != null ? user.toObject() : user;
  return PUBLIC_USER_RESPONSE_FIELDS.reduce((userData, field) => {
    if (source[field] !== undefined) {
      userData[field] = source[field];
    }
    return userData;
  }, {});
};

const getUserController = async (req, res) => {
  const appConfig =
    req.config ??
    (await getAppConfig({
      role: req.user?.role,
      userId: req.user?.id,
      tenantId: req.user?.tenantId,
    }));
  /** @type {IUser} */
  const userData = sanitizeUserForResponse(req.user);
  if (appConfig.fileStrategy === FileSources.s3 && userData.avatar) {
    const avatarNeedsRefresh = needsRefresh(userData.avatar, 3600);
    if (!avatarNeedsRefresh) {
      return res.status(200).send(userData);
    }
    const originalAvatar = userData.avatar;
    try {
      userData.avatar = await getNewS3URL(userData.avatar);
      await db.updateUser(userData.id, { avatar: userData.avatar });
    } catch (error) {
      userData.avatar = originalAvatar;
      logger.error('Error getting new S3 URL for avatar:', error);
    }
  }
  res.status(200).send(userData);
};

const getTermsStatusController = async (req, res) => {
  try {
    const user = await db.getUserById(req.user.id, 'termsAccepted termsAcceptedAt');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.status(200).json({
      termsAccepted: !!user.termsAccepted,
      termsAcceptedAt: user.termsAcceptedAt || null,
    });
  } catch (error) {
    logger.error('Error fetching terms acceptance status:', error);
    res.status(500).json({ message: 'Error fetching terms acceptance status' });
  }
};

const acceptTermsController = async (req, res) => {
  try {
    const user = await db.acceptTerms(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.status(200).json({
      message: 'Terms accepted successfully',
      termsAcceptedAt: user.termsAcceptedAt,
    });
  } catch (error) {
    logger.error('Error accepting terms:', error);
    res.status(500).json({ message: 'Error accepting terms' });
  }
};

const updateUserPluginsController = async (req, res) => {
  const appConfig =
    req.config ??
    (await getAppConfig({
      role: req.user?.role,
      userId: req.user?.id,
      tenantId: req.user?.tenantId,
    }));
  const { user } = req;
  const { pluginKey, action, auth, isEntityTool } = req.body;
  try {
    if (!isEntityTool) {
      await db.updateUserPlugins(user._id, user.plugins, pluginKey, action);
    }

    if (auth == null) {
      return res.status(200).send();
    }

    let keys = Object.keys(auth);
    const values = Object.values(auth); // Used in 'install' block

    const isMCPTool = pluginKey.startsWith('mcp_') || pluginKey.includes(Constants.mcp_delimiter);

    // Early exit condition:
    // If keys are empty (meaning auth: {} was likely sent for uninstall, or auth was empty for install)
    // AND it's not web_search (which has special key handling to populate `keys` for uninstall)
    // AND it's NOT (an uninstall action FOR an MCP tool - we need to proceed for this case to clear all its auth)
    // THEN return.
    if (
      keys.length === 0 &&
      pluginKey !== Tools.web_search &&
      !(action === 'uninstall' && isMCPTool)
    ) {
      return res.status(200).send();
    }

    /** @type {number} */
    let status = 200;
    /** @type {string} */
    let message;
    /** @type {IPluginAuth | Error} */
    let authService;

    if (pluginKey === Tools.web_search) {
      /** @type  {TCustomConfig['webSearch']} */
      const webSearchConfig = appConfig?.webSearch;
      keys = extractWebSearchEnvVars({
        keys: action === 'install' ? keys : webSearchKeys,
        config: webSearchConfig,
      });
    }

    if (action === 'install') {
      for (let i = 0; i < keys.length; i++) {
        authService = await updateUserPluginAuth(user.id, keys[i], pluginKey, values[i]);
        if (authService instanceof Error) {
          logger.error('[authService]', authService);
          ({ status, message } = normalizeHttpError(authService));
        }
      }
    } else if (action === 'uninstall') {
      // const isMCPTool was defined earlier
      if (isMCPTool && keys.length === 0) {
        // This handles the case where auth: {} is sent for an MCP tool uninstall.
        // It means "delete all credentials associated with this MCP pluginKey".
        authService = await deleteUserPluginAuth(user.id, null, true, pluginKey);
        if (authService instanceof Error) {
          logger.error(
            `[authService] Error deleting all auth for MCP tool ${pluginKey}:`,
            authService,
          );
          ({ status, message } = normalizeHttpError(authService));
        }
        try {
          // if the MCP server uses OAuth, perform a full cleanup and token revocation
          await maybeUninstallOAuthMCP(user.id, pluginKey, appConfig);
        } catch (error) {
          logger.error(
            `[updateUserPluginsController] Error uninstalling OAuth MCP for ${pluginKey}:`,
            error,
          );
        }
      } else {
        // This handles:
        // 1. Web_search uninstall (keys will be populated with all webSearchKeys if auth was {}).
        // 2. Other tools uninstall (if keys were provided).
        // 3. MCP tool uninstall if specific keys were provided in `auth` (not current frontend behavior).
        // If keys is empty for non-MCP tools (and not web_search), this loop won't run, and nothing is deleted.
        for (let i = 0; i < keys.length; i++) {
          authService = await deleteUserPluginAuth(user.id, keys[i]); // Deletes by authField name
          if (authService instanceof Error) {
            logger.error('[authService] Error deleting specific auth key:', authService);
            ({ status, message } = normalizeHttpError(authService));
          }
        }
      }
    }

    if (status === 200) {
      // If auth was updated successfully, disconnect MCP sessions as they might use these credentials
      if (pluginKey.startsWith(Constants.mcp_prefix)) {
        try {
          const mcpManager = getMCPManager();
          if (mcpManager) {
            // Extract server name from pluginKey (format: "mcp_<serverName>")
            const serverName = pluginKey.replace(Constants.mcp_prefix, '');
            logger.info(
              `[updateUserPluginsController] Attempting disconnect of MCP server "${serverName}" for user ${user.id} after plugin auth update.`,
            );
            await mcpManager.disconnectUserConnection(user.id, serverName);
            await invalidateCachedTools({ userId: user.id, serverName });
          }
        } catch (disconnectError) {
          logger.error(
            `[updateUserPluginsController] Error disconnecting MCP connection for user ${user.id} after plugin auth update:`,
            disconnectError,
          );
          // Do not fail the request for this, but log it.
        }
      }
      return res.status(status).send();
    }

    const normalized = normalizeHttpError({ status, message });
    return res.status(normalized.status).send({ message: normalized.message });
  } catch (err) {
    logger.error('[updateUserPluginsController]', err);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

const verifyEmailController = async (req, res) => {
  try {
    const verifyEmailService = await verifyEmail(req);
    if (verifyEmailService instanceof Error) {
      return res.status(400).json({ message: verifyEmailService.message });
    } else {
      return res.status(200).json(verifyEmailService);
    }
  } catch (e) {
    logger.error('[verifyEmailController]', e);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

const resendVerificationController = async (req, res) => {
  try {
    const result = await resendVerificationEmail(req);
    if (result instanceof Error) {
      return res.status(400).json({ message: result.message });
    } else {
      return res.status(result.status ?? 200).json({ message: result.message });
    }
  } catch (e) {
    logger.error('[verifyEmailController]', e);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/** Best-effort cleanup of stored MCP OAuth tokens and flow state. */
const clearStoredMCPOAuthState = async (userId, serverName) => {
  try {
    await MCPTokenStorage.deleteUserTokens({
      userId,
      serverName,
      deleteToken: async (filter) => {
        await db.deleteTokens(filter);
      },
    });
  } catch (error) {
    logger.warn(
      `[clearStoredMCPOAuthState] Failed to delete MCP OAuth tokens for ${serverName}:`,
      error,
    );
  }

  try {
    const flowsCache = getLogStores(CacheKeys.FLOWS);
    const flowManager = getFlowStateManager(flowsCache);
    const baseFlowId = MCPOAuthHandler.generateFlowId(userId, serverName);
    const tenantId = getTenantId();
    const tokenFlowId = MCPOAuthHandler.generateTokenFlowId(userId, serverName, tenantId);
    const oauthFlowId = MCPOAuthHandler.generateFlowId(userId, serverName, tenantId);
    const flowDeletes = [
      [tokenFlowId, 'mcp_get_tokens'],
      [oauthFlowId, 'mcp_oauth'],
      [baseFlowId, 'mcp_get_tokens'],
      [baseFlowId, 'mcp_oauth'],
    ].filter(
      ([flowId, type], index, deletes) =>
        deletes.findIndex(([candidateId, candidateType]) => {
          return candidateId === flowId && candidateType === type;
        }) === index,
    );
    const results = await Promise.allSettled(
      flowDeletes.map(([flowId, type]) => flowManager.deleteFlow(flowId, type)),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        logger.warn(
          `[clearStoredMCPOAuthState] Failed to clear MCP OAuth flow state for ${serverName}:`,
          result.reason,
        );
      }
    }
  } catch (error) {
    logger.warn(
      `[clearStoredMCPOAuthState] Failed to clear MCP OAuth flow state for ${serverName}:`,
      error,
    );
  }
};

/** Revokes MCP OAuth tokens at the provider when possible, then clears local state. */
const maybeUninstallOAuthMCP = async (userId, pluginKey, appConfig) => {
  if (!pluginKey.startsWith(Constants.mcp_prefix)) {
    // this is not an MCP server, so nothing to do here
    return;
  }

  const serverName = pluginKey.replace(Constants.mcp_prefix, '');
  const serverConfig =
    (await getMCPServersRegistry().getServerConfig(serverName, userId)) ??
    appConfig?.mcpServers?.[serverName];
  const oauthServers = await getMCPServersRegistry().getOAuthServers(userId);
  if (!oauthServers.has(serverName) || !serverConfig) {
    await clearStoredMCPOAuthState(userId, serverName);
    return;
  }

  // 1. get client info used for revocation (client id, secret)
  let clientTokenData = null;
  try {
    clientTokenData = await MCPTokenStorage.getClientInfoAndMetadata({
      userId,
      serverName,
      findToken: db.findToken,
    });
  } catch (error) {
    logger.warn(
      `[maybeUninstallOAuthMCP] Unable to load OAuth client metadata for ${serverName}; clearing local MCP OAuth state only.`,
      error,
    );
    await clearStoredMCPOAuthState(userId, serverName);
    return;
  }
  if (clientTokenData == null) {
    logger.info(
      `[maybeUninstallOAuthMCP] Missing OAuth client metadata for ${serverName}; clearing local MCP OAuth state only.`,
    );
    await clearStoredMCPOAuthState(userId, serverName);
    return;
  }
  const { clientInfo, clientMetadata } = clientTokenData;

  // 2. get decrypted tokens before deletion
  let tokens = null;
  try {
    tokens = await MCPTokenStorage.getTokens({
      userId,
      serverName,
      findToken: db.findToken,
    });
  } catch (error) {
    logger.warn(
      `[maybeUninstallOAuthMCP] Unable to load OAuth tokens for ${serverName}; clearing local token state.`,
      error,
    );
  }

  // 3. revoke OAuth tokens at the provider
  const revocationEndpoint =
    serverConfig.oauth?.revocation_endpoint ?? clientMetadata.revocation_endpoint;
  const revocationEndpointAuthMethodsSupported =
    serverConfig.oauth?.revocation_endpoint_auth_methods_supported ??
    clientMetadata.revocation_endpoint_auth_methods_supported;
  const oauthHeaders = serverConfig.oauth_headers ?? {};
  // Use the request's merged (tenant/principal-scoped) allowlists so admin-panel mcpSettings
  // overrides are honored for OAuth revocation, consistent with inspection/connection.
  const allowedDomains = appConfig?.mcpSettings?.allowedDomains;
  const allowedAddresses = appConfig?.mcpSettings?.allowedAddresses;

  if (tokens?.access_token) {
    try {
      await MCPOAuthHandler.revokeOAuthToken(
        serverName,
        tokens.access_token,
        'access',
        {
          serverUrl: serverConfig.url,
          clientId: clientInfo.client_id,
          clientSecret: clientInfo.client_secret ?? '',
          revocationEndpoint,
          revocationEndpointAuthMethodsSupported,
        },
        oauthHeaders,
        allowedDomains,
        allowedAddresses,
      );
    } catch (error) {
      logger.error(
        `[maybeUninstallOAuthMCP] Error revoking OAuth access token for ${serverName}:`,
        error,
      );
    }
  }

  if (tokens?.refresh_token) {
    try {
      await MCPOAuthHandler.revokeOAuthToken(
        serverName,
        tokens.refresh_token,
        'refresh',
        {
          serverUrl: serverConfig.url,
          clientId: clientInfo.client_id,
          clientSecret: clientInfo.client_secret ?? '',
          revocationEndpoint,
          revocationEndpointAuthMethodsSupported,
        },
        oauthHeaders,
        allowedDomains,
        allowedAddresses,
      );
    } catch (error) {
      logger.error(
        `[maybeUninstallOAuthMCP] Error revoking OAuth refresh token for ${serverName}:`,
        error,
      );
    }
  }

  // 4. delete tokens from the DB and clear the flow state after revocation attempts
  await clearStoredMCPOAuthState(userId, serverName);
};

module.exports = {
  getUserController,
  getTermsStatusController,
  acceptTermsController,
  verifyEmailController,
  updateUserPluginsController,
  resendVerificationController,
  maybeUninstallOAuthMCP,
};
