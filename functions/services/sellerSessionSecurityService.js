function clean(value = '') {
  return String(value || '').trim();
}

function passwordVersion(context = {}, user = {}) {
  const hash = clean(user?.passwordHash);
  if (!hash || !context.crypto?.createHmac || !context.JWT_SECRET) return '';
  return context.crypto
    .createHmac('sha256', context.JWT_SECRET)
    .update(hash)
    .digest('hex')
    .slice(0, 40);
}

function sellerStatus(value = {}) {
  return clean(value?.status || value?.metadata?.status).toLowerCase();
}

function isSellerBlocked(seller = {}) {
  return [
    'pending', 'pending_onboarding', 'pendente', 'aguardando_aprovacao',
    'rejected', 'reprovado', 'blocked', 'bloqueado', 'suspended', 'suspenso',
    'inactive', 'inativo'
  ].includes(sellerStatus(seller));
}

async function findSellerForSession(context = {}, user = {}, claims = {}) {
  const Seller = context.Seller;
  if (!Seller) return null;

  const sid = clean(user?.sellerId || claims?.sellerId);
  if (sid) {
    const seller = await Seller.findOne({ sellerId: sid });
    if (seller) return seller;
  }

  if (user?._id) {
    const seller = await Seller.findOne({ userId: user._id });
    if (seller) return seller;
  }

  return null;
}

function revokedAtMs(seller = {}) {
  const raw = seller?.metadata?.sellerAuthRevokedAt;
  if (!raw) return 0;
  const value = new Date(raw).getTime();
  return Number.isFinite(value) ? value : 0;
}

function isSellerNotificationPath(req = {}) {
  const path = clean(req.path || req.originalUrl).split('?')[0];
  return path === '/api/seller/notifications' || path.startsWith('/api/seller/notifications/');
}

function sanitizeSellerNotification(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  if (clean(value.audience).toLowerCase() !== 'seller') return value;

  const metadata = value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata)
    ? { ...value.metadata }
    : value.metadata;

  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    delete metadata.total;
  }

  if (clean(value.type) === 'seller_order_paid') {
    const orderId = clean(value.relatedId || metadata?.orderId);
    const shortId = orderId ? orderId.slice(-8).toUpperCase() : '';
    return {
      ...value,
      message: shortId
        ? `Pedido #${shortId} com pagamento aprovado.`
        : 'Pagamento do pedido aprovado.',
      metadata
    };
  }

  return { ...value, metadata };
}

function sanitizeSellerNotificationPayload(payload) {
  if (Array.isArray(payload)) return payload.map(sanitizeSellerNotification);
  if (payload && typeof payload === 'object' && Array.isArray(payload.items)) {
    return { ...payload, items: payload.items.map(sanitizeSellerNotification) };
  }
  return sanitizeSellerNotification(payload);
}

function installSellerNotificationPrivacyBoundary(req = {}, res = {}) {
  if (!isSellerNotificationPath(req) || typeof res.json !== 'function') return;
  const originalJson = res.json.bind(res);
  res.json = function sellerNotificationPrivacyJson(payload) {
    return originalJson(sanitizeSellerNotificationPayload(payload));
  };
}

export function createSellerSignToken(context = {}) {
  return function signSellerToken(user = {}) {
    if (!context.jwt?.sign || !context.JWT_SECRET) {
      throw new Error('JWT indisponível para autenticação do Seller.');
    }

    const pwdVersion = passwordVersion(context, user);
    if (!pwdVersion) {
      throw new Error('Credencial de senha do Seller indisponível.');
    }

    return context.jwt.sign({
      id: String(user._id),
      email: user.email,
      role: user.role || 'seller',
      sellerId: user.sellerId || null,
      admin: false,
      sellerAuthVersion: 1,
      sellerPasswordVersion: pwdVersion,
      sellerIssuedAtMs: Date.now()
    }, context.JWT_SECRET, { expiresIn: '7d' });
  };
}

export function createSellerSessionBoundary(context = {}) {
  return async function sellerSessionBoundary(req, res, next) {
    try {
      const header = clean(req.headers?.authorization || req.headers?.Authorization);
      const token = header.startsWith('Bearer ') ? clean(header.slice(7)) : '';
      if (!token) {
        return res.status(401).json({ ok: false, code: 'SELLER_TOKEN_MISSING', error: 'Token do Seller ausente.' });
      }

      let claims;
      try {
        claims = context.jwt?.verify?.(token, context.JWT_SECRET);
      } catch (_) {
        return res.status(401).json({ ok: false, code: 'SELLER_TOKEN_INVALID', error: 'Sessão do Seller inválida ou expirada.' });
      }

      if (Number(claims?.sellerAuthVersion || 0) !== 1) {
        return res.status(401).json({
          ok: false,
          code: 'SELLER_SESSION_REFRESH_REQUIRED',
          error: 'Sua sessão do Seller foi atualizada por segurança. Entre novamente.'
        });
      }

      const user = claims?.id && context.User ? await context.User.findById(claims.id) : null;
      if (!user || user.isActive === false) {
        return res.status(401).json({ ok: false, code: 'SELLER_SESSION_USER_INVALID', error: 'Sessão do Seller inválida.' });
      }

      const currentPasswordVersion = passwordVersion(context, user);
      if (!currentPasswordVersion || clean(claims?.sellerPasswordVersion) !== currentPasswordVersion) {
        return res.status(401).json({
          ok: false,
          code: 'SELLER_SESSION_REVOKED_PASSWORD_CHANGED',
          error: 'Sua senha foi alterada. Entre novamente no Seller.'
        });
      }

      const seller = await findSellerForSession(context, user, claims);
      if (!seller) {
        return res.status(403).json({ ok: false, code: 'SELLER_ACCOUNT_NOT_LINKED', error: 'Conta Seller não vinculada.' });
      }

      if (isSellerBlocked(seller)) {
        return res.status(403).json({ ok: false, code: 'SELLER_NOT_ACTIVE', error: 'Acesso do Seller indisponível.' });
      }

      const issuedAtMs = Number(claims?.sellerIssuedAtMs || 0);
      const revoked = revokedAtMs(seller);
      if (!Number.isFinite(issuedAtMs) || issuedAtMs <= 0 || (revoked > 0 && issuedAtMs <= revoked)) {
        return res.status(401).json({
          ok: false,
          code: 'SELLER_SESSION_REVOKED',
          error: 'Sessão do Seller encerrada. Entre novamente.'
        });
      }

      const sellerId = clean(seller.sellerId);
      const claimedSellerId = clean(claims?.sellerId);
      if (claimedSellerId && sellerId && claimedSellerId !== sellerId) {
        return res.status(403).json({ ok: false, code: 'SELLER_SESSION_SCOPE_MISMATCH', error: 'Sessão não pertence a este Seller.' });
      }

      req.sellerSessionClaims = claims;
      req.sellerSessionUser = user;
      req.sellerSessionSeller = seller;
      installSellerNotificationPrivacyBoundary(req, res);
      return next();
    } catch (error) {
      console.error('[seller-session] Falha ao validar sessão:', error);
      return res.status(401).json({ ok: false, code: 'SELLER_SESSION_INVALID', error: 'Sessão do Seller inválida.' });
    }
  };
}

export function routeUsesSellerAuth(handlers = []) {
  return handlers.some((handler) => typeof handler === 'function' && handler.name === 'sellerAuthRequired');
}

export function registerSellerLogoutRoute(app, context = {}) {
  if (!app?.post || !context.Seller) return;

  const boundary = createSellerSessionBoundary(context);
  app.post('/api/seller/auth/logout', boundary, async (req, res) => {
    try {
      const seller = req.sellerSessionSeller;
      if (!seller) return res.status(401).json({ ok: false, error: 'Sessão do Seller inválida.' });

      const metadata = seller.metadata && typeof seller.metadata === 'object'
        ? { ...seller.metadata }
        : {};
      metadata.sellerAuthRevokedAt = new Date().toISOString();
      seller.metadata = metadata;
      seller.markModified?.('metadata');
      await seller.save();

      if (typeof context.writeAuditLog === 'function') {
        await context.writeAuditLog({
          scope: 'seller_auth',
          eventType: 'seller_logout',
          status: 'success',
          metadata: {
            sellerId: clean(seller.sellerId),
            userId: String(req.sellerSessionUser?._id || '')
          }
        }).catch(() => null);
      }

      return res.json({ ok: true, message: 'Sessão do Seller encerrada.' });
    } catch (error) {
      console.error('[seller-session] Falha ao encerrar sessão:', error);
      return res.status(500).json({ ok: false, error: 'Erro ao encerrar sessão do Seller.' });
    }
  });
}
