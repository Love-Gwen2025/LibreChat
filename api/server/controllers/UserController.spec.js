jest.mock('@librechat/data-schemas', () => {
  const actual = jest.requireActual('@librechat/data-schemas');
  return {
    ...actual,
    logger: {
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
    },
  };
});

jest.mock('~/models', () => {
  return {
    updateUserPlugins: jest.fn(),
    updateUser: jest.fn(),
    acceptTerms: jest.fn(),
    getUserById: jest.fn().mockResolvedValue(null),
    findToken: jest.fn(),
  };
});

jest.mock('~/server/services/PluginService', () => ({
  updateUserPluginAuth: jest.fn(),
  deleteUserPluginAuth: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('~/server/services/AuthService', () => ({
  verifyEmail: jest.fn(),
  resendVerificationEmail: jest.fn(),
}));

jest.mock('sharp', () =>
  jest.fn(() => ({
    metadata: jest.fn().mockResolvedValue({}),
    toFormat: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.alloc(0)),
  })),
);

jest.mock('@librechat/api', () => ({
  ...jest.requireActual('@librechat/api'),
  needsRefresh: jest.fn(),
  getNewS3URL: jest.fn(),
}));

jest.mock('~/server/services/Config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({}),
  getMCPManager: jest.fn(),
  getFlowStateManager: jest.fn(),
  getMCPServersRegistry: jest.fn(),
}));

jest.mock('~/cache', () => ({
  getLogStores: jest.fn(),
}));

const {
  getUserController,
  acceptTermsController,
  resendVerificationController,
  verifyEmailController,
} = require('./UserController');
const { acceptTerms } = require('~/models');
const { verifyEmail, resendVerificationEmail } = require('~/server/services/AuthService');

describe('verifyEmailController', () => {
  const mockRes = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the generic verification error message from service failures', async () => {
    verifyEmail.mockResolvedValue(new Error('Invalid or expired email verification token'));

    await verifyEmailController(
      { body: { email: 'user%40example.com', token: 'not-the-token' } },
      mockRes,
    );

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      message: 'Invalid or expired email verification token',
    });
  });

  it('uses the service status for resend verification responses', async () => {
    resendVerificationEmail.mockResolvedValue({ status: 500, message: 'Something went wrong.' });

    await resendVerificationController({ body: { email: 'user@example.com' } }, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({ message: 'Something went wrong.' });
  });
});

describe('getUserController', () => {
  const mockRes = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should only expose public user response fields from the request user', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const updatedAt = new Date('2026-01-02T00:00:00.000Z');
    const req = {
      config: {},
      user: {
        id: 'user-id',
        _id: 'user-id',
        name: 'OpenID User',
        username: 'openid-user',
        email: 'openid@test.com',
        emailVerified: true,
        avatar: '/avatars/user-id.png',
        provider: 'openid',
        role: 'USER',
        plugins: ['web_search'],
        twoFactorEnabled: true,
        termsAccepted: true,
        personalization: { memories: false },
        favorites: [{ model: 'gpt-5', endpoint: 'openAI' }],
        skillStates: { skill_one: true },
        createdAt,
        updatedAt,
        tenantId: 'tenant-id',
        password: 'hashed-password',
        __v: 1,
        totpSecret: 'totp-secret',
        backupCodes: [{ codeHash: 'backup-code' }],
        pendingTotpSecret: 'pending-totp-secret',
        pendingBackupCodes: [{ codeHash: 'pending-backup-code' }],
        refreshToken: [{ refreshToken: 'legacy-refresh-token' }],
        googleId: 'google-id',
        openidId: 'openid-id',
        openidIssuer: 'openid-issuer',
        idOnTheSource: 'external-source-id',
        federatedTokens: {
          access_token: 'access-token',
          id_token: 'id-token',
          refresh_token: 'refresh-token',
        },
        openidTokens: {
          access_token: 'openid-access-token',
          refresh_token: 'openid-refresh-token',
        },
        tokenset: {
          access_token: 'tokenset-access-token',
          refresh_token: 'tokenset-refresh-token',
        },
        safeLookingRuntimeField: 'internal-value',
      },
    };

    await getUserController(req, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(200);
    const sentUser = mockRes.send.mock.calls[0][0];
    expect(sentUser).toMatchObject({
      id: 'user-id',
      _id: 'user-id',
      name: 'OpenID User',
      username: 'openid-user',
      email: 'openid@test.com',
      emailVerified: true,
      avatar: '/avatars/user-id.png',
      provider: 'openid',
      role: 'USER',
      plugins: ['web_search'],
      twoFactorEnabled: true,
      termsAccepted: true,
      personalization: { memories: false },
      favorites: [{ model: 'gpt-5', endpoint: 'openAI' }],
      skillStates: { skill_one: true },
      createdAt,
      updatedAt,
      tenantId: 'tenant-id',
    });
    expect(sentUser).not.toHaveProperty('password');
    expect(sentUser).not.toHaveProperty('__v');
    expect(sentUser).not.toHaveProperty('totpSecret');
    expect(sentUser).not.toHaveProperty('backupCodes');
    expect(sentUser).not.toHaveProperty('pendingTotpSecret');
    expect(sentUser).not.toHaveProperty('pendingBackupCodes');
    expect(sentUser).not.toHaveProperty('refreshToken');
    expect(sentUser).not.toHaveProperty('googleId');
    expect(sentUser).not.toHaveProperty('openidId');
    expect(sentUser).not.toHaveProperty('openidIssuer');
    expect(sentUser).not.toHaveProperty('idOnTheSource');
    expect(sentUser).not.toHaveProperty('federatedTokens');
    expect(sentUser).not.toHaveProperty('openidTokens');
    expect(sentUser).not.toHaveProperty('tokenset');
    expect(sentUser).not.toHaveProperty('safeLookingRuntimeField');
  });
});

describe('acceptTermsController', () => {
  const mockRes = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 404 when the user does not exist', async () => {
    acceptTerms.mockResolvedValueOnce(null);

    await acceptTermsController({ user: { id: 'missing-user' } }, mockRes);

    expect(acceptTerms).toHaveBeenCalledWith('missing-user');
    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith({ message: 'User not found' });
  });

  it('returns the recorded acceptance timestamp on success', async () => {
    const acceptedAt = new Date('2026-06-14T10:00:00.000Z');
    acceptTerms.mockResolvedValueOnce({ termsAccepted: true, termsAcceptedAt: acceptedAt });

    await acceptTermsController({ user: { id: 'user-id' } }, mockRes);

    expect(acceptTerms).toHaveBeenCalledWith('user-id');
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({
      message: 'Terms accepted successfully',
      termsAcceptedAt: acceptedAt,
    });
  });

  it('returns 500 when the update throws', async () => {
    acceptTerms.mockRejectedValueOnce(new Error('db down'));

    await acceptTermsController({ user: { id: 'user-id' } }, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({ message: 'Error accepting terms' });
  });
});
