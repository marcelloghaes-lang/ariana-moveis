// ============================================================
// ROTAS PRINCIPAIS / AUTH / USUÁRIO - ARIANA MÓVEIS
// Extraído do legacyRoutes.js na Etapa 3.
// Mantém exatamente os mesmos endpoints e respostas.
// ============================================================

export default function registerCoreAuthUserRoutes(app, context = {}) {
  const {
    BUILD_ID,
    bcrypt,
    changedKeys,
    crypto,
    EMAIL_FROM,
    EMAIL_HOST,
    EMAIL_PASS,
    EMAIL_PORT,
    EMAIL_SECURE,
    EMAIL_USER,
    FRONTEND_URL,
    GOOGLE_CLIENT_ID,
    googleClient,
    authRequired,
    JWT_SECRET,
    mongoose,
    nodemailer,
    RESET_PASSWORD_URL,
    Seller,
    signToken,
    toJSON,
    uid,
    User,
    writeAuditLog
  } = context;

app.get('/', (_req, res) => res.json({ ok: true, service: 'Ariana Móveis Enterprise Mongo API', buildId: BUILD_ID }));
app.get('/health', (_req, res) => res.json({ ok: true, mongo: mongoose.connection.readyState === 1 ? 'connected' : `state_${mongoose.connection.readyState}`, buildId: BUILD_ID, uptime: process.uptime(), time: new Date().toISOString() }));

function isEmailConfigured() {
  return Boolean(EMAIL_HOST && EMAIL_USER && EMAIL_PASS);
}

function getMailTransporter() {
  if (!isEmailConfigured()) return null;
  return nodemailer.createTransport({
    host: EMAIL_HOST,
    port: EMAIL_PORT,
    secure: EMAIL_SECURE,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS }
  });
}

function buildResetPasswordUrl(token = '') {
  const base = RESET_PASSWORD_URL || `${FRONTEND_URL}/redefinir_senha.html`;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}token=${encodeURIComponent(token)}`;
}

async function sendPasswordResetEmail(user, resetUrl) {
  const transporter = getMailTransporter();
  const name = String(user?.name || user?.email || 'cliente').trim();

  const subject = 'Redefinição de senha - Ariana Móveis';
  const text = `Olá, ${name}!\n\nRecebemos uma solicitação para redefinir sua senha na Ariana Móveis.\n\nAcesse o link abaixo para criar uma nova senha. O link expira em 1 hora:\n${resetUrl}\n\nSe você não solicitou essa alteração, ignore este e-mail.`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
      <h2 style="color:#2E6DA4">Redefinição de senha</h2>
      <p>Olá, <strong>${name}</strong>!</p>
      <p>Recebemos uma solicitação para redefinir sua senha na Ariana Móveis.</p>
      <p>O link abaixo expira em <strong>1 hora</strong>:</p>
      <p><a href="${resetUrl}" style="display:inline-block;background:#2E6DA4;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Criar nova senha</a></p>
      <p>Se o botão não funcionar, copie e cole este link no navegador:</p>
      <p style="word-break:break-all;color:#374151">${resetUrl}</p>
      <p style="font-size:12px;color:#6b7280">Se você não solicitou essa alteração, ignore este e-mail.</p>
    </div>`;

  if (!transporter) {
    console.warn('[auth/forgot-password] SMTP não configurado. Link de redefinição:', resetUrl);
    return { ok: false, skipped: true, reason: 'email_not_configured' };
  }

  await transporter.sendMail({
    from: EMAIL_FROM,
    to: user.email,
    subject,
    text,
    html
  });
  return { ok: true };
}

function normalizePublicUserForAuth(user) {
  const obj = toJSON(user) || {};
  delete obj.passwordHash;
  delete obj.resetPasswordTokenHash;
  delete obj.resetPasswordExpiresAt;
  return obj;
}

app.get('/api/auth/google-config', (_req, res) => {
  return res.json({ ok: true, enabled: Boolean(GOOGLE_CLIENT_ID), clientId: GOOGLE_CLIENT_ID || '' });
});

app.post('/api/auth/google-login', async (req, res) => {
  try {
    if (!GOOGLE_CLIENT_ID || !googleClient) {
      return res.status(500).json({ ok: false, error: 'Login com Google não configurado no servidor.' });
    }

    const idToken = String(req.body?.credential || req.body?.idToken || req.body?.token || '').trim();
    if (!idToken) return res.status(400).json({ ok: false, error: 'Token do Google ausente.' });

    const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload() || {};
    const email = String(payload.email || '').trim().toLowerCase();
    const googleId = String(payload.sub || '').trim();
    const name = String(payload.name || payload.given_name || (email ? email.split('@')[0] : 'Cliente')).trim();

    if (!email || !googleId) return res.status(401).json({ ok: false, error: 'Conta Google inválida.' });

    let user = await User.findOne({ $or: [{ email }, { googleId }] });
    if (!user) {
      user = await User.create({
        name,
        email,
        googleId,
        emailVerified: payload.email_verified === true,
        authProvider: 'google',
        role: 'customer',
        isActive: true
      });
    } else {
      let changed = false;
      if (!user.googleId) { user.googleId = googleId; changed = true; }
      if (!user.name && name) { user.name = name; changed = true; }
      if (payload.email_verified === true && user.emailVerified !== true) { user.emailVerified = true; changed = true; }
      if (user.authProvider !== 'google') { user.authProvider = user.passwordHash ? 'password_google' : 'google'; changed = true; }
      if (changed) await user.save();
    }

    if (user.isActive === false) return res.status(403).json({ ok: false, error: 'Usuário desativado.' });

    const token = signToken(user);
    return res.json({ ok: true, token, user: normalizePublicUserForAuth(user) });
  } catch (error) {
    console.error('Erro em /api/auth/google-login:', error);
    return res.status(401).json({ ok: false, error: 'Não foi possível validar o login com Google.' });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ ok: false, error: 'Informe o e-mail cadastrado.' });

    const user = await User.findOne({ email });

    // Resposta neutra para não revelar se o e-mail existe ou não.
    const neutralResponse = {
      ok: true,
      message: 'Se este e-mail estiver cadastrado, enviaremos um link para redefinir a senha.'
    };

    if (!user) return res.json(neutralResponse);

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await User.updateOne(
  { _id: user._id },
  {
    $set: {
      resetPasswordTokenHash: tokenHash,
      resetPasswordExpiresAt: new Date(Date.now() + 60 * 60 * 1000)
    }
  }
);

    const resetUrl = buildResetPasswordUrl(token);
    const emailResult = await sendPasswordResetEmail(user, resetUrl);

    await writeAuditLog({
      scope: 'auth',
      eventType: 'password_reset_requested',
      status: 'success',
      metadata: { userId: String(user._id), emailConfigured: isEmailConfigured(), emailSent: emailResult?.ok === true }
    }).catch(() => null);

    return res.json({
      ...neutralResponse,
      emailSent: emailResult?.ok === true,
      emailConfigured: isEmailConfigured(),
      debugResetUrl: String(process.env.ALLOW_DEBUG_RESET_LINK || '').toLowerCase() === 'true' ? resetUrl : undefined
    });
  } catch (error) {
    console.error('Erro em /api/auth/forgot-password:', error);
    return res.status(500).json({ ok: false, error: 'Erro ao solicitar recuperação de senha.' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    const password = String(req.body?.password || req.body?.newPassword || '');

    if (!token) return res.status(400).json({ ok: false, error: 'Token de redefinição ausente.' });
    if (!password || password.length < 6) return res.status(400).json({ ok: false, error: 'A nova senha deve ter no mínimo 6 caracteres.' });

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      resetPasswordTokenHash: tokenHash,
      resetPasswordExpiresAt: { $gt: new Date() }
    });

    if (!user) return res.status(400).json({ ok: false, error: 'Link inválido ou expirado. Solicite uma nova recuperação de senha.' });

   await User.updateOne(
  { _id: user._id },
  {
    $set: {
      passwordHash: await bcrypt.hash(password, 10),
      authProvider: user.googleId ? 'password_google' : 'password'
    },
    $unset: {
      resetPasswordTokenHash: '',
      resetPasswordExpiresAt: ''
    }
  }
);

    await writeAuditLog({
      scope: 'auth',
      eventType: 'password_reset_completed',
      status: 'success',
      metadata: { userId: String(user._id) }
    }).catch(() => null);

    return res.json({ ok: true, message: 'Senha redefinida com sucesso.' });
  } catch (error) {
    console.error('Erro em /api/auth/reset-password:', error);
    return res.status(500).json({ ok: false, error: 'Erro ao redefinir senha.' });
  }
});

app.post('/api/auth/change-password', authRequired, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || req.body?.current_password || '');
    const newPassword = String(req.body?.newPassword || req.body?.password || '');

    if (!newPassword || newPassword.length < 6) return res.status(400).json({ ok: false, error: 'A nova senha deve ter no mínimo 6 caracteres.' });

    const storedHash = String(req.user.passwordHash || '');
    if (storedHash) {
      const valid = await bcrypt.compare(currentPassword, storedHash).catch(() => false);
      if (!valid) return res.status(401).json({ ok: false, error: 'Senha atual inválida.' });
    }

    req.user.passwordHash = await bcrypt.hash(newPassword, 10);
    if (!req.user.authProvider || req.user.authProvider === 'google') req.user.authProvider = req.user.googleId ? 'password_google' : 'password';
    await req.user.save();
    return res.json({ ok: true, message: 'Senha atualizada com sucesso.' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar senha.' });
  }
});

app.post('/api/auth/register', async (req, res) => { try { const body = req.body || {}; const email = String(body.email || '').trim().toLowerCase(); const password = String(body.password || ''); const name = String(body.name || '').trim(); if (!email || !password || !name) return res.status(400).json({ ok: false, error: 'Nome, e-mail e senha são obrigatórios' }); const existing = await User.findOne({ email }); if (existing) return res.status(409).json({ ok: false, error: 'E-mail já cadastrado' }); const passwordHash = await bcrypt.hash(password, 10); const user = await User.create({ name, email, passwordHash, cpf: body.cpf || '', phone: body.phone || '', role: body.role === 'seller' ? 'seller' : 'customer', city: body.city || '', uf: body.uf || '' }); if (user.role === 'seller') { const sellerId = uid('seller'); await Seller.create({ sellerId, userId: user._id, displayName: name, storeName: body.storeName || name, email, phone: body.phone || '', document: body.cpf || '', status: 'pending' }); user.sellerId = sellerId; await user.save(); } const token = signToken(user); return res.json({ ok: true, token, user: toJSON(user) }); } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Erro ao registrar usuário' }); } });
app.post('/api/auth/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'E-mail e senha são obrigatórios' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ ok: false, error: 'Credenciais inválidas' });
    }

    const storedHash = String(user.passwordHash || '');
    let valid = false;

    if (storedHash) {
      try {
        valid = await bcrypt.compare(password, storedHash);
      } catch (_bcryptErr) {
        valid = false;
      }

      if (!valid && storedHash === password) {
        valid = true;
        user.passwordHash = await bcrypt.hash(password, 10);
        await user.save();
      }
    }

    if (!valid) {
      return res.status(401).json({ ok: false, error: 'Credenciais inválidas' });
    }

    const token = signToken(user);
    return res.json({ ok: true, token, user: toJSON(user) });
  } catch (error) {
    console.error('Erro em /api/auth/login:', error);
    return res.status(500).json({ ok: false, error: 'Erro ao fazer login' });
  }
});
app.get('/api/me', authRequired, (req, res) => res.json({ ok: true, user: toJSON(req.user) }));
app.patch('/api/users/me', authRequired, async (req, res) => { try { const allowed = ['name', 'cpf', 'phone', 'city', 'uf']; const patch = {}; for (const key of allowed) if (req.body[key] !== undefined) patch[key] = req.body[key]; const before = toJSON(req.user); const after = await User.findByIdAndUpdate(req.user._id, { $set: patch }, { new: true }); await writeAuditLog({ scope: 'user_profile', eventType: 'user_profile_updated', status: 'success', changedKeys: changedKeys(before, toJSON(after)), metadata: { userId: String(req.user._id) } }); return res.json({ ok: true, user: toJSON(after) }); } catch (_error) { return res.status(500).json({ ok: false, error: 'Erro ao atualizar perfil' }); } });
}
