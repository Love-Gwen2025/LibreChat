const { isEnabled } = require('@librechat/api');

function validateRegistration(req, res, next) {
  if (req.invite) {
    return next();
  }

  // 邀请码校验: 如果配置了 INVITE_CODE, 注册时必须提供正确的邀请码
  const inviteCode = process.env.INVITE_CODE;
  if (inviteCode) {
    if (req.body.inviteCode === inviteCode) {
      return next();
    }
    return res.status(403).json({
      message: '邀请码无效或未提供。',
    });
  }

  // 没有配置邀请码时, 走默认的 ALLOW_REGISTRATION 逻辑
  if (isEnabled(process.env.ALLOW_REGISTRATION)) {
    next();
  } else {
    return res.status(403).json({
      message: 'Registration is not allowed.',
    });
  }
}

module.exports = validateRegistration;
