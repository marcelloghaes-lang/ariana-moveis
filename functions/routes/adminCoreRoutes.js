// ============================================================
// ROTAS ADMIN CORE / UPLOAD / POSTERS / CRUD GENÉRICO
// Extraído de legacyRoutes.js na Etapa 16.
// Objetivo: reduzir legacyRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerAdminCoreRoutes(app, context = {}) {
  const {
    ADMIN_EMAIL,
    ADMIN_NAME,
    ADMIN_PASSWORD,
    APP_BASE_URL,
    MONGODB_DB,
    PORT,
    DEFAULT_CURRENCY,
    User,
    AdminSession,
    AdminLoginEvent,
    Setting,
    Product,
    Category,
    Order,
    Banner,
    Ticket,
    Notification,
    OperationalAlert,
    Seller,
    adminRequired,
    bcrypt,
    signAdminToken,
    getWhatsappSettings,
    getShippingSettings,
    getPaymentsSettings,
    setSetting,
    getSetting,
    redactWhatsappSettings,
    redact,
    cloudinary,
    upload,
    uploadToCloudinary,
    isCloudinaryConfigured,
    safeUploadFolder,
    path,
    fs,
    uploadsDir,
    buildCloudinaryFolder,
    sanitizeIdPart,
    generateProductPosterBuffer,
    normalizeObjectId,
    normalizeProductForResponse,
    productPayloadFromBody,
    toJSON,
    changedKeys,
    createAdminNotification,
    createSellerOrderNotifications,
    waMaybeNotifyOrderStatusChange,
    waNotifyAdminOrderStatusChange,
    writeAuditLog,
    buildPublicFileUrl,
    escapeRegex,
    ensureArray,
    now,
    mongoose,
    BUILD_ID
  } = context;

app.get('/api/admin/runtime', adminRequired, async (_req, res) => { const whatsapp = await getWhatsappSettings(); const shipping = await getShippingSettings(); const payments = await getPaymentsSettings(); return res.json({ ok: true, buildId: BUILD_ID, runtime: { nodeEnv: process.env.NODE_ENV || 'development', port: PORT, appBaseUrl: APP_BASE_URL || null, contaboPublicUrl: process.env.CONTABO_PUBLIC_URL || null, evolutionApiUrl: whatsapp.apiUrl || null, evolutionInstance: whatsapp.instanceName || null, mongoDb: MONGODB_DB }, integrations: { whatsapp: redactWhatsappSettings(whatsapp), shipping, payments: redact(payments) } }); });
app.use((error, _req, res, _next) => { console.error('❌ Erro não tratado:', error); return res.status(500).json({ ok: false, error: error.message || 'Erro interno' }); });





function clientInfo(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || req.ip || req.socket?.remoteAddress || '';
  const ua = String(req.headers['user-agent'] || '');
  const browser = /Edg\//i.test(ua) ? 'Edge' : /Chrome\//i.test(ua) ? 'Chrome' : /Firefox\//i.test(ua) ? 'Firefox' : /Safari\//i.test(ua) ? 'Safari' : 'Outro';
  const os = /Windows/i.test(ua) ? 'Windows' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Outro';
  const device = /Mobile|Android|iPhone|iPad/i.test(ua) ? 'Celular/Tablet' : 'Computador';
  return { ip, userAgent: ua, browser, os, device };
}

async function recordLoginEvent(payload = {}) {
  if (!AdminLoginEvent) return;
  await AdminLoginEvent.create(payload).catch(() => null);
}

app.post('/api/admin/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || req.body?.senha || '');
    const info = clientInfo(req);
    if (!email || !password) return res.status(400).json({ ok: false, error: 'email_password_required' });

    let adminUser = null;
    let dbUser = await User.findOne({ email });
    let dbPasswordWasInvalid = false;

    // Prioriza sempre a conta cadastrada no Mongo. Assim, quando o mesmo
    // e-mail também estiver configurado no .env, a sessão mantém o _id real.
    if (dbUser && dbUser.lockedUntil && dbUser.lockedUntil > new Date()) {
      await recordLoginEvent({
        userId: String(dbUser._id),
        email,
        event: 'login_blocked',
        success: false,
        reason: 'temporary_lock',
        ...info
      });
      return res.status(423).json({
        ok: false,
        error: 'login_temporarily_locked',
        message: 'Muitas tentativas incorretas. Tente novamente mais tarde.',
        lockedUntil: dbUser.lockedUntil
      });
    }

    if (
      dbUser &&
      ['admin', 'staff'].includes(String(dbUser.role || '').toLowerCase()) &&
      dbUser.isActive !== false
    ) {
      let valid = false;
      if (dbUser.passwordHash) {
        try {
          valid = await bcrypt.compare(password, dbUser.passwordHash);
        } catch (_error) {
          valid = false;
        }
      }
      if (!valid && typeof dbUser.password === 'string' && dbUser.password) {
        valid = password === dbUser.password;
      }
      if (!valid && typeof dbUser.senha === 'string' && dbUser.senha) {
        valid = password === dbUser.senha;
      }

      if (valid) {
        dbUser.failedLoginAttempts = 0;
        dbUser.lockedUntil = null;
        dbUser.lastLoginAt = new Date();
        dbUser.lastLoginIp = info.ip;
        dbUser.lastLoginUserAgent = info.userAgent;
        dbUser.lastLoginBrowser = info.browser;
        dbUser.lastLoginOs = info.os;
        dbUser.lastLoginDevice = info.device;
        await dbUser.save().catch(() => null);

        const role =
          String(dbUser.role || '').toLowerCase() === 'staff'
            ? 'staff'
            : 'admin';

        adminUser = {
          id: String(dbUser._id),
          userId: String(dbUser._id),
          uid: String(dbUser._id),
          email: String(dbUser.email || email).trim().toLowerCase(),
          role,
          admin: role === 'admin',
          active: dbUser.isActive !== false,
          name: dbUser.name || (role === 'admin' ? ADMIN_NAME : 'Colaborador'),
          permissions: Array.isArray(dbUser.permissions) ? dbUser.permissions : [],
          mustChangePassword: dbUser.mustChangePassword === true,
          tokenVersion: Number(dbUser.tokenVersion || 0)
        };
      } else {
        dbPasswordWasInvalid = true;
      }
    }

    // Mantém a conta de emergência do .env como fallback, sem sobrepor uma
    // autenticação válida da conta cadastrada no banco.
    if (
      !adminUser &&
      ADMIN_EMAIL &&
      ADMIN_PASSWORD &&
      email === String(ADMIN_EMAIL).trim().toLowerCase() &&
      password === ADMIN_PASSWORD
    ) {
      adminUser = {
        id: 'env-admin',
        userId: 'env-admin',
        uid: 'env-admin',
        email,
        role: 'admin',
        admin: true,
        active: true,
        name: ADMIN_NAME,
        tokenVersion: 0
      };
      dbPasswordWasInvalid = false;
    }

    if (!adminUser && dbUser && dbPasswordWasInvalid) {
      dbUser.failedLoginAttempts = Number(dbUser.failedLoginAttempts || 0) + 1;
      if (dbUser.failedLoginAttempts >= 5) {
        dbUser.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
        dbUser.failedLoginAttempts = 0;
      }
      await dbUser.save().catch(() => null);
      await recordLoginEvent({
        userId: String(dbUser._id),
        email,
        event: dbUser.lockedUntil ? 'automatic_lock' : 'login_failed',
        success: false,
        reason: 'invalid_credentials',
        ...info
      });
    }

    if (!adminUser) {
      await recordLoginEvent({ userId: dbUser?._id ? String(dbUser._id) : '', email, event: 'login_failed', success: false, reason: 'invalid_credentials', ...info });
      return res.status(401).json({ ok: false, error: 'invalid_admin_credentials', message: 'E-mail ou senha de administrador inválidos.' });
    }

    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    if (AdminSession) {
      if (dbUser && dbUser.allowMultipleSessions === false) {
        await AdminSession.updateMany(
          {
            active: true,
            $or: [
              { userId: adminUser.id },
              { email: adminUser.email }
            ]
          },
          {
            $set: {
              active: false,
              revokedAt: new Date(),
              revokedBy: adminUser.email,
              revokeReason: 'new_login'
            }
          }
        );
      }
      await AdminSession.create({
        sessionId,
        userId: adminUser.id,
        email: adminUser.email,
        active: true,
        expiresAt,
        ...info
      });
    }
    await recordLoginEvent({ userId: adminUser.id, email: adminUser.email, event: 'login_success', success: true, sessionId, ...info });

    const token = signAdminToken({ ...adminUser, sessionId });
    return res.json({ ok: true, token, id: adminUser.id, userId: adminUser.userId, uid: adminUser.uid, email: adminUser.email, role: adminUser.role, admin: adminUser.role === 'admin', active: adminUser.active !== false, name: adminUser.name || ADMIN_NAME, sessionId, user: { ...adminUser, sessionId } });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'admin_login_failed' });
  }
});

app.post('/api/admin/logout', adminRequired, async (req, res) => {
  const sessionId = String(req.admin?.sessionId || req.auth?.sessionId || '');
  if (sessionId && AdminSession) await AdminSession.updateOne({ sessionId }, { $set: { active: false, revokedAt: new Date(), revokedBy: req.admin?.email || '', revokeReason: 'logout' } }).catch(() => null);
  await recordLoginEvent({ userId: String(req.admin?.id || ''), email: req.admin?.email || '', event: 'logout', success: true, sessionId, ...clientInfo(req) });
  return res.json({ ok: true });
});

app.get('/api/admin/me', adminRequired, async (req, res) => {
  const admin = req.admin || req.user || {};
  const role = String(admin.role || 'admin').toLowerCase();
  return res.json({
    ok: true,
    id: String(admin.id || admin.uid || admin._id || 'admin'),
    email: admin.email || '',
    role,
    admin: role === 'admin' || admin.admin === true,
    name: admin.name || (role === 'admin' ? ADMIN_NAME : 'Colaborador'),
    permissions: Array.isArray(admin.permissions) ? admin.permissions : [],
    isSuperAdmin: admin.isSuperAdmin === true
  });
});

app.get('/api/admin/store-settings', adminRequired, async (_req, res) => {
  try {
    const payments = await getPaymentsSettings();
    const shipping = await getShippingSettings();
    return res.json({
      ok: true,
      settings: {
        payments: {
          mercadopago: {
            publicKey: payments?.mercadopago?.publicKey || '',
            mode: payments?.mercadopago?.mode || 'prod',
            enablePix: payments?.mercadopago?.enablePix !== false,
            enableCard: payments?.mercadopago?.enableCard !== false,
            enableBoleto: payments?.mercadopago?.enableBoleto !== false,
            enabled: payments?.mercadopago?.enabled !== false,
            splitEnabled: payments?.mercadopago?.splitEnabled !== false
          },
          pagarme: payments?.pagarme || {}
        },
        shipping: {
          ...shipping,
          correios: {
            ...(shipping?.correios || {}),
            maxKg: Number(
              shipping?.correios?.maxKg ??
              shipping?.correios?.maxWeightKg ??
              shipping?.carriers?.correios?.maxWeightKg ??
              30
            ),
            maxDimCm: Number(
              shipping?.correios?.maxDimCm ??
              shipping?.correios?.maxDimensionCm ??
              shipping?.carriers?.correios?.maxDimensionCm ??
              100
            )
          },
          heavyCarriers: Array.isArray(shipping?.heavyCarriers)
            ? shipping.heavyCarriers
            : [],
          manualRules: Array.isArray(shipping?.manualRules)
            ? shipping.manualRules
            : []
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'store_settings_read_failed' });
  }
});

app.put('/api/admin/store-settings', adminRequired, async (req, res) => {
  try {
    const body = req.body || {};
    const updatedBy = String((req.user && (req.user._id || req.user.id || req.user.uid || req.user.email)) || 'admin');

    let paymentsSettings = await getPaymentsSettings();
    let shippingSettings = await getShippingSettings();

    if (body.payments && body.payments.mercadopago) {
      paymentsSettings = {
        ...paymentsSettings,
        mercadopago: {
          ...(paymentsSettings?.mercadopago || {}),
          ...(body.payments.mercadopago || {})
        },
        pagarme: {
          ...(paymentsSettings?.pagarme || {})
        }
      };
      await setSetting('payments', paymentsSettings, updatedBy);
    }

    if (body.shipping) {
      const incomingShipping = body.shipping || {};
      shippingSettings = {
        ...shippingSettings,
        ...incomingShipping,
        correios: {
          ...(shippingSettings?.correios || {}),
          ...(incomingShipping.correios || {})
        },
        heavyCarriers: Array.isArray(incomingShipping.heavyCarriers)
          ? incomingShipping.heavyCarriers
          : (Array.isArray(shippingSettings?.heavyCarriers) ? shippingSettings.heavyCarriers : []),
        manualRules: Array.isArray(incomingShipping.manualRules)
          ? incomingShipping.manualRules
          : (Array.isArray(shippingSettings?.manualRules) ? shippingSettings.manualRules : [])
      };

      if (shippingSettings.correios) {
        if (shippingSettings.correios.maxKg !== undefined) {
          shippingSettings.correios.maxWeightKg = Number(shippingSettings.correios.maxKg || 30);
        }
        if (shippingSettings.correios.maxDimCm !== undefined) {
          shippingSettings.correios.maxDimensionCm = Number(shippingSettings.correios.maxDimCm || 100);
        }
      }

      await setSetting('shipping', shippingSettings, updatedBy);
    }

    const finalPayments = await getPaymentsSettings();
    const finalShipping = await getShippingSettings();

    return res.json({
      ok: true,
      settings: {
        payments: finalPayments,
        shipping: {
          ...finalShipping,
          correios: {
            ...(finalShipping?.correios || {}),
            maxKg: Number(
              finalShipping?.correios?.maxKg ??
              finalShipping?.correios?.maxWeightKg ??
              finalShipping?.carriers?.correios?.maxWeightKg ??
              30
            ),
            maxDimCm: Number(
              finalShipping?.correios?.maxDimCm ??
              finalShipping?.correios?.maxDimensionCm ??
              finalShipping?.carriers?.correios?.maxDimensionCm ??
              100
            )
          },
          heavyCarriers: Array.isArray(finalShipping?.heavyCarriers) ? finalShipping.heavyCarriers : [],
          manualRules: Array.isArray(finalShipping?.manualRules) ? finalShipping.manualRules : []
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'store_settings_save_failed' });
  }
});

app.patch('/api/admin/store-settings', adminRequired, async (req, res) => {
  req.method = 'PUT';
  return app._router.handle(req, res, () => {});
});




function uploadBufferToCloudinary(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder || 'ariana_moveis/posters',
        public_id: options.public_id,
        resource_type: 'image',
        overwrite: true,
        format: 'png'
      },
      (error, result) => {
        if (error) return reject(error);
        return resolve(result);
      }
    );
    stream.end(buffer);
  });
}



function pickProductImage(product = {}) {
  const imgs = Array.isArray(product.images) ? product.images : [];
  const main = imgs.find((img) => img && img.isMain && (img.url || img.imageUrl)) || imgs.find((img) => img && (img.url || img.imageUrl));
  return String(product.mainImageUrl || product.imageUrl || product.image || product.imagem || main?.url || main?.imageUrl || '').trim();
}

function normalizeBannerText(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function productBannerGroup(product = {}) {
  const text = normalizeBannerText(`${product.name || ''} ${product.title || ''} ${product.category || ''} ${product.categoryName || ''} ${product.description || ''}`);
  if (/colch|cama box|travesseiro|pillow/.test(text)) return 'colchoes';
  if (/smart\s*tv|televis|\btv\b|roku|monitor/.test(text)) return 'tvs';
  if (/smartphone|celular|iphone|galaxy|motorola|moto\s*g/.test(text)) return 'celulares';
  if (/caixa de som|som|audio|amplificad|speaker|bluetooth|antena/.test(text)) return 'som';
  if (/ar condicionado|climatizador|ventilador|ventisol|turbo/.test(text)) return 'climatizacao';
  if (/notebook|computador|informatica|impressora|teclado|mouse|tablet/.test(text)) return 'informatica';
  if (/geladeira|refrigerador|freezer|lavadora|maquina de lavar|tanquinho|fogao|fogão|cooktop|forno|micro-ondas|microondas|air fryer|fritadeira|eletrodomestico|eletrodoméstico/.test(text)) return 'eletrodomesticos';
  if (/guarda[- ]?roupa|roupeiro|sofa|sof[aá]|rack|painel|mesa|cadeira|cozinha|armario|armário|comoda|cômoda|balcao|balcão|multiuso|moveis|móveis/.test(text)) return 'moveis';
  return 'geral';
}

const BANNER_GROUP_RULES = {
  moveis: /m[oó]veis|guarda[- ]?roupa|roupeiro|sof[aá]|rack|painel|mesa|cadeira|cozinha|arm[aá]rio|c[oô]moda|balc[aã]o|multiuso/i,
  eletrodomesticos: /eletrodom[eé]sticos|geladeira|refrigerador|freezer|lavadora|m[aá]quina de lavar|tanquinho|fog[aã]o|cooktop|forno|micro[- ]?ondas|air fryer|fritadeira/i,
  colchoes: /colch[oõ]es?|cama box|travesseiro|pillow/i,
  celulares: /smartphone|celular|iphone|galaxy|motorola|moto\s*g/i,
  tvs: /smart\s*tv|televis[aã]o|\btv\b|roku|monitor/i,
  som: /som|[aá]udio|caixa de som|amplificada|bluetooth|antena/i,
  climatizacao: /ar condicionado|climatizador|ventilador|ventisol|turbo/i,
  informatica: /inform[aá]tica|notebook|computador|impressora|teclado|mouse|tablet/i
};

function regexForBannerGroup(group = '') {
  return BANNER_GROUP_RULES[String(group || '').trim()] || null;
}

function bannerCopyForDefinition(def = {}, products = []) {
  const group = String(def.group || productBannerGroup(products[0] || {}) || 'geral').trim();

  // Textos de campanha por CATEGORIA, não por produto individual.
  // Assim o banner fica profissional: mostra produtos da categoria e uma chamada geral da seção.
  const copies = {
    moveis: [
      'As melhores ofertas de móveis você encontra aqui',
      'Ambientes completos, bonitos e funcionais para transformar sua casa.'
    ],
    eletrodomesticos: [
      'Eletrodomésticos com as melhores condições de pagamento',
      'Geladeiras, lavadoras, fogões e utilidades para facilitar seu dia a dia.'
    ],
    colchoes: [
      'Conforto de verdade para suas noites de descanso',
      'Colchões selecionados com qualidade, preço justo e compra segura.'
    ],
    celulares: [
      'Tecnologia que acompanha sua rotina',
      'Smartphones selecionados com ofertas especiais para você aproveitar mais.'
    ],
    tvs: [
      'Imagem de cinema para sua sala',
      'Smart TVs selecionadas para transformar seus momentos em família.'
    ],
    som: [
      'Som de qualidade para todos os momentos',
      'Caixas, áudio e acessórios selecionados com ofertas especiais.'
    ],
    climatizacao: [
      'Mais conforto para sua casa todos os dias',
      'Ventiladores e climatização com preço especial para deixar seu ambiente melhor.'
    ],
    informatica: [
      'Os melhores produtos eletrônicos e tecnologia do mercado',
      'Produtos escolhidos para transformar sua vida num verdadeiro sonho.'
    ],
    geral: [
      def.title || 'Ofertas selecionadas Ariana Móveis',
      def.subtitle || 'Produtos escolhidos com qualidade, preço especial e compra segura.'
    ]
  };

  const [title, subtitle] = copies[group] || copies.geral;
  return { title, subtitle };
}

async function loadRemoteImageAsPng(url, width, height) {
  if (!url) return null;

  try {
    const { default: sharp } = await import('sharp');
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: { 'User-Agent': 'ArianaMoveisBannerBot/2.0' }
    });

    const source = Buffer.from(response.data);

    // IMPORTANTE:
    // O código anterior transformava pixels brancos em transparência.
    // Isso estragava produto branco/cinza, como guarda-roupa, geladeira, ventilador e TV.
    // Agora a imagem é tratada com fundo branco preservado, sem apagar partes do produto.
    let img = sharp(source, { failOn: 'none' })
      .rotate()
      .flatten({ background: '#ffffff' });

    // Corta somente a borda branca externa quando possível, sem remover branco do produto.
    try {
      img = img.trim({ background: '#ffffff', threshold: 10 });
    } catch (_error) {
      img = sharp(source, { failOn: 'none' }).rotate().flatten({ background: '#ffffff' });
    }

    return await img
      .resize(Math.round(width), Math.round(height), {
        fit: 'inside',
        position: 'center',
        withoutEnlargement: false,
        kernel: sharp.kernel.lanczos3,
        background: '#ffffff'
      })
      .sharpen({ sigma: 0.45, m1: 0.7, m2: 0.35 })
      .png({ quality: 100, compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
  } catch (error) {
    console.error('Erro ao carregar imagem do produto para banner:', error?.message || error);
    return null;
  }
}

function bannerDraftDefinitions() {
  return [
    { key: 'index_main', targetSlot: 'index_main', title: 'Ofertas imperdíveis', subtitle: 'Preço especial no PIX e parcelamento sem juros', width: 1920, height: 480, productLimit: 3, group: 'moveis', href: 'categoria.html?category=Móveis' },
    { key: 'index_sidebar_vertical', targetSlot: 'index_sidebar_vertical', title: 'Promoção especial', subtitle: 'Escolha seu produto e compre pelo WhatsApp', width: 600, height: 900, productLimit: 1, group: 'tvs', href: 'todos_produtos.html?section=offers' },{ key: 'index_mini_1', targetSlot: 'index_mini_1', title: 'Móveis em destaque', subtitle: 'Renove sua casa com preço especial', width: 800, height: 450, productLimit: 2, group: 'moveis', href: 'categoria.html?category=Móveis' },
    { key: 'index_mini_2', targetSlot: 'index_mini_2', title: 'Som e áudio', subtitle: 'Produtos selecionados para você', width: 800, height: 450, productLimit: 2, group: 'som', href: 'categoria.html?category=Som e Ãudio' },
    { key: 'index_mini_3', targetSlot: 'index_mini_3', title: 'Climatização', subtitle: 'Mais conforto para sua casa', width: 800, height: 450, productLimit: 2, group: 'climatizacao', href: 'categoria.html?category=Ventiladores' },
    { key: 'index_mini_4', targetSlot: 'index_mini_4', title: 'Celulares', subtitle: 'Smartphones com ofertas especiais', width: 800, height: 450, productLimit: 2, group: 'celulares', href: 'categoria.html?category=Smartphones' },
    { key: 'index_mini_5', targetSlot: 'index_mini_5', title: 'Smart TVs', subtitle: 'Imagem de cinema para sua sala', width: 800, height: 450, productLimit: 2, group: 'tvs', href: 'categoria.html?category=Smart Tv' },

    { key: 'index_duo_1', targetSlot: 'index_duo_1', title: 'Lançamentos', subtitle: 'Novidades selecionadas para sua casa', width: 1200, height: 400, productLimit: 2, group: 'moveis', href: 'categoria.html?category=Móveis' },
    { key: 'index_duo_2', targetSlot: 'index_duo_2', title: 'Recomendado pra você', subtitle: 'Produtos escolhidos para vender mais', width: 1200, height: 400, productLimit: 2, group: 'eletrodomesticos', href: 'categoria.html?category=Eletrodomésticos' },

    { key: 'index_secondary_1', targetSlot: 'index_secondary_1', title: 'Queridinhos da internet', subtitle: 'Os produtos mais procurados na Ariana Móveis', width: 1200, height: 350, productLimit: 2, group: 'eletrodomesticos', href: 'categoria.html?category=Eletrodomésticos' },
    { key: 'index_secondary_2', targetSlot: 'index_secondary_2', title: 'Promoção exclusiva', subtitle: 'Selecionamos ofertas para você economizar', width: 1200, height: 350, productLimit: 2, group: 'colchoes', href: 'categoria.html?category=Colchões' },

    { key: 'home_card_1', targetSlot: 'home_card_1', title: 'Eletrodomésticos', subtitle: 'Geladeiras, lavadoras e muito mais', width: 800, height: 800, productLimit: 2, group: 'eletrodomesticos', href: 'categoria.html?category=Eletrodomésticos' },
    { key: 'home_card_2', targetSlot: 'home_card_2', title: 'Informática', subtitle: 'Tecnologia para sua rotina', width: 800, height: 800, productLimit: 2, group: 'informatica', href: 'categoria.html?category=Informática' },
    { key: 'home_card_3', targetSlot: 'home_card_3', title: 'Móveis', subtitle: 'Ambientes bonitos e completos', width: 800, height: 800, productLimit: 2, group: 'moveis', href: 'categoria.html?category=Móveis' },

    { key: 'footer_banner', targetSlot: 'footer_banner', title: 'Mais ofertas para você', subtitle: 'Ariana Móveis: compra fácil pelo site ou WhatsApp', width: 1920, height: 400, productLimit: 3, group: 'colchoes', href: 'categoria.html?category=Colchões' },
    { key: 'header_category_banner', targetSlot: 'header_category_banner', title: 'Categorias Ariana', subtitle: 'Encontre móveis, eletros, colchões e tecnologia', width: 900, height: 520, productLimit: 2, group: 'moveis', href: 'todos_produtos.html' },

    { key: 'produto_detail_horizontal_1', targetSlot: 'produto_detail_horizontal_1', title: 'Complemente sua compra', subtitle: 'Produtos selecionados para combinar com sua casa', width: 1200, height: 350, productLimit: 2, group: 'moveis', href: 'categoria.html?category=Móveis' },
    { key: 'produto_detail_horizontal_2', targetSlot: 'produto_detail_horizontal_2', title: 'Oferta especial Ariana', subtitle: 'Condições imperdíveis por tempo limitado', width: 1200, height: 350, productLimit: 2, group: 'eletrodomesticos', href: 'categoria.html?category=Eletrodomésticos' }
  ];
}

async function selectProductsForBanner(definition, usedIds = new Set(), limit = 3) {
  const base = { active: { $ne: false } };
  const groupRx = regexForBannerGroup(definition.group) || definition.categoryRegex || null;
  const query = groupRx ? {
    ...base,
    $or: [{ category: groupRx }, { categoryName: groupRx }, { name: groupRx }, { description: groupRx }, { brand: groupRx }]
  } : base;

  let docs = await Product.find(query).sort({ isOffer: -1, isHighlight: -1, updatedAt: -1, createdAt: -1 }).limit(limit * 8);
  // Nunca completa banner de categoria com produto de outra família. Se achou só 1, usa só 1.
  docs = docs.filter((doc) => !definition.group || productBannerGroup(normalizeProductForResponse(doc)) === definition.group);

  const chosen = [];
  for (const doc of docs) {
    const id = String(doc._id);
    if (usedIds.has(id) && docs.length > limit) continue;
    chosen.push(doc);
    usedIds.add(id);
    if (chosen.length >= limit) break;
  }
  return chosen.map(normalizeProductForResponse);
}

function bannerShortName(product = '') {
  const name = String(product.name || product.title || 'Oferta especial').trim();
  return name.length > 42 ? `${name.slice(0, 39).trim()}...` : name;
}

function bannerPrice(product = {}) {
  const value = Number(product.pixPrice || product.precoPix || product.price || product.preco || 0);
  if (!Number.isFinite(value) || value <= 0) return '';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

async function generateMarketingBannerBuffer({ title, subtitle, products = [], width = 1600, height = 520, targetSlot = '', group: forcedGroup = '' }) {
  const { default: sharp } = await import('sharp');

  const W = Number(width || 1600);
  const H = Number(height || 520);
  const isVertical = H > W;
  const isSquare = Math.abs(W - H) < 60;
  const isThin = (W / H) >= 3.2;

  const group = String(forcedGroup || productBannerGroup(products[0] || { name: title, category: subtitle }) || 'geral');
  const copy = bannerCopyForDefinition({ title, subtitle, group }, products);
  const safeTitle = xmlEscape(copy.title || title || 'Ariana Móveis');
  const safeSubtitle = xmlEscape(copy.subtitle || subtitle || 'Ofertas selecionadas para você');

  const margin = Math.round(W * (isVertical ? 0.070 : 0.052));
  const R = Math.round(Math.min(W, H) * 0.045);

  const brandFs = Math.max(15, Math.round(Math.min(W, H) * (isThin ? 0.034 : isSquare ? 0.036 : 0.038)));
  const eyebrowFs = Math.max(10, Math.round(Math.min(W, H) * (isThin ? 0.023 : 0.020)));
  const titleFs = Math.max(28, Math.round(Math.min(W, H) * (isThin ? 0.070 : isSquare ? 0.060 : isVertical ? 0.057 : 0.068)));
  const subFs = Math.max(16, Math.round(Math.min(W, H) * (isThin ? 0.032 : isSquare ? 0.028 : isVertical ? 0.027 : 0.032)));
  const ctaH = Math.max(42, Math.round(H * (isThin ? 0.145 : isSquare ? 0.088 : isVertical ? 0.070 : 0.128)));
  const ctaW = Math.round(W * (isVertical ? 0.62 : isSquare ? 0.43 : isThin ? 0.25 : 0.32));
  const textW = isVertical ? Math.round(W * 0.84) : Math.round(W * (isThin ? 0.43 : isSquare ? 0.45 : 0.44));

  const brandY = Math.round(H * (isThin ? 0.14 : 0.112));
  const titleTop = Math.round(H * (isThin ? 0.240 : isSquare ? 0.150 : isVertical ? 0.160 : 0.205));
  const titleBoxH = Math.round(titleFs * (isThin ? 2.0 : isVertical ? 2.75 : 2.30));
  const subTop = Math.round(titleTop + titleBoxH + H * 0.012);
  const ctaX = margin;
  const ctaY = Math.round(H - ctaH - H * (isThin ? 0.125 : 0.085));
  const phoneFs = Math.max(10, Math.round(Math.min(W, H) * (isThin ? 0.024 : 0.019)));

  const bg = Buffer.from(`
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#003A90"/>
          <stop offset="45%" stop-color="#0057CB"/>
          <stop offset="100%" stop-color="#041D47"/>
        </linearGradient>
        <linearGradient id="shine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.20"/>
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
        </linearGradient>
        <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#001E4D" flood-opacity="0.34"/>
        </filter>
      </defs>
      <rect width="${W}" height="${H}" rx="${R}" fill="url(#bg)"/>
      <circle cx="${Math.round(W * 0.80)}" cy="${Math.round(-H * 0.08)}" r="${Math.round(Math.min(W, H) * 0.75)}" fill="url(#shine)"/>
      <circle cx="${Math.round(W * 0.96)}" cy="${Math.round(H * 0.92)}" r="${Math.round(Math.min(W, H) * 0.55)}" fill="#F7C600" opacity="0.18"/>
      <circle cx="${Math.round(W * 0.63)}" cy="${Math.round(H * 0.58)}" r="${Math.round(Math.min(W, H) * 0.25)}" fill="#ffffff" opacity="0.07"/>

      <rect x="${margin}" y="${Math.round(brandY - brandFs * 0.90)}" width="${Math.round(brandFs * 8.6)}" height="${Math.round(brandFs * 1.38)}" rx="${Math.round(brandFs * 0.40)}" fill="#ffffff" opacity="0.10"/>
      <text x="${margin + Math.round(brandFs * 0.42)}" y="${brandY}" font-family="Inter, Arial, Helvetica, sans-serif" font-size="${brandFs}" font-weight="950" fill="#F7C600">ARIANA MÓVEIS</text>
      <text x="${margin}" y="${Math.round(brandY + brandFs * 1.35)}" font-family="Inter, Arial, Helvetica, sans-serif" font-size="${eyebrowFs}" font-weight="900" fill="#DDEBFF">OFERTAS SELECIONADAS • COMPRA SEGURA</text>

      <foreignObject x="${margin}" y="${titleTop}" width="${textW}" height="${titleBoxH}">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Inter,Arial,Helvetica,sans-serif;font-size:${titleFs}px;font-weight:950;line-height:1.02;color:#ffffff;letter-spacing:-1px;text-shadow:0 5px 14px rgba(0,0,0,.22);">${safeTitle}</div>
      </foreignObject>
      <foreignObject x="${margin}" y="${subTop}" width="${textW}" height="${Math.round(subFs * 4.2)}">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Inter,Arial,Helvetica,sans-serif;font-size:${subFs}px;font-weight:800;line-height:1.18;color:#EAF4FF;">${safeSubtitle}</div>
      </foreignObject>

      <rect x="${ctaX}" y="${ctaY}" width="${ctaW}" height="${ctaH}" rx="${Math.round(ctaH * 0.36)}" fill="#16A34A" filter="url(#shadow)"/>
      <text x="${ctaX + ctaW / 2}" y="${Math.round(ctaY + ctaH * 0.63)}" text-anchor="middle" font-family="Inter, Arial, Helvetica, sans-serif" font-size="${Math.max(13, Math.round(ctaH * 0.36))}" font-weight="950" fill="#ffffff">COMPRE AGORA</text>
      <text x="${margin}" y="${Math.round(H * 0.935)}" font-family="Inter, Arial, Helvetica, sans-serif" font-size="${phoneFs}" font-weight="900" fill="#ffffff">WhatsApp: (31) 98514-7119</text>
    </svg>`);

  const composites = [{ input: bg, top: 0, left: 0 }];

  function productPositions(count = 1) {
    if (isVertical) {
      return count <= 1
        ? [{ left: Math.round(W * 0.12), top: Math.round(H * 0.40), width: Math.round(W * 0.76), height: Math.round(H * 0.42) }]
        : [
            { left: Math.round(W * 0.08), top: Math.round(H * 0.38), width: Math.round(W * 0.54), height: Math.round(H * 0.35) },
            { left: Math.round(W * 0.38), top: Math.round(H * 0.51), width: Math.round(W * 0.54), height: Math.round(H * 0.35) }
          ];
    }

    if (isSquare) {
      return count <= 1
        ? [{ left: Math.round(W * 0.44), top: Math.round(H * 0.20), width: Math.round(W * 0.48), height: Math.round(H * 0.50) }]
        : [
            { left: Math.round(W * 0.42), top: Math.round(H * 0.18), width: Math.round(W * 0.40), height: Math.round(H * 0.40) },
            { left: Math.round(W * 0.57), top: Math.round(H * 0.45), width: Math.round(W * 0.34), height: Math.round(H * 0.34) }
          ];
    }

    if (isThin) {
      return count <= 1
        ? [{ left: Math.round(W * 0.56), top: Math.round(H * 0.08), width: Math.round(W * 0.38), height: Math.round(H * 0.78) }]
        : [
            { left: Math.round(W * 0.49), top: Math.round(H * 0.12), width: Math.round(W * 0.21), height: Math.round(H * 0.66) },
            { left: Math.round(W * 0.65), top: Math.round(H * 0.10), width: Math.round(W * 0.21), height: Math.round(H * 0.66) },
            { left: Math.round(W * 0.79), top: Math.round(H * 0.14), width: Math.round(W * 0.18), height: Math.round(H * 0.62) }
          ];
    }

    return count <= 1
      ? [{ left: Math.round(W * 0.55), top: Math.round(H * 0.10), width: Math.round(W * 0.38), height: Math.round(H * 0.72) }]
      : [
          { left: Math.round(W * 0.47), top: Math.round(H * 0.12), width: Math.round(W * 0.28), height: Math.round(H * 0.68) },
          { left: Math.round(W * 0.68), top: Math.round(H * 0.14), width: Math.round(W * 0.25), height: Math.round(H * 0.64) }
        ];
  }

  const positions = productPositions(products.length);

  for (let i = 0; i < Math.min(products.length, positions.length); i += 1) {
    const pos = positions[i];
    const product = products[i] || {};
    const productPng = await loadRemoteImageAsPng(pickProductImage(product), pos.width, pos.height);
    if (!productPng) continue;

    const meta = await sharp(productPng).metadata();
    const left = Math.round(pos.left + (pos.width - (meta.width || pos.width)) / 2);
    const top = Math.round(pos.top + (pos.height - (meta.height || pos.height)) / 2);

    composites.push({
      input: Buffer.from(`<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="${Math.round(pos.left + pos.width / 2)}" cy="${Math.round(pos.top + pos.height * 0.94)}" rx="${Math.round(pos.width * 0.35)}" ry="${Math.round(pos.height * 0.060)}" fill="#001A3D" opacity="0.22"/>
      </svg>`),
      top: 0,
      left: 0
    });

    // Sem etiqueta individual, sem nome individual e sem preço individual em cima do produto.
    // A legenda do banner fica somente na chamada principal por categoria.
    composites.push({ input: productPng, left, top });
  }

  return sharp({ create: { width: W, height: H, channels: 4, background: '#ffffff' } })
    .composite(composites)
    .png({ quality: 100, compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

function normalizePosterSiteCtaOptions(input = {}) {
  const siteUrl = String(input.siteUrl || input.storeUrl || input.urlLoja || input.website || input.site || process.env.STORE_SITE_URL || FRONTEND_URL || 'https://arianamoveis.com.br').trim() || 'https://arianamoveis.com.br';
  const cleanSiteUrl = siteUrl.replace(/\/+$/, '');
  const siteText = String(input.siteText || input.storeText || input.textoSite || 'arianamoveis.com.br').trim() || 'arianamoveis.com.br';
  const ctaText = String(input.ctaText || input.buttonText || input.botaoTexto || 'COMPRE DIRETO DO SITE').trim() || 'COMPRE DIRETO DO SITE';
  const ctaSubtext = String(input.ctaSubtext || input.buttonSubtext || input.subtextoBotao || siteText).trim() || siteText;
  const mascotImageUrl = String(input.mascotImageUrl || input.mascoteUrl || input.avatarUrl || process.env.POSTER_MASCOT_IMAGE_URL || '').trim();

  return {
    siteUrl: cleanSiteUrl,
    storeUrl: cleanSiteUrl,
    linkUrl: cleanSiteUrl,
    siteText,
    ctaText,
    buttonText: ctaText,
    ctaSubtext,
    buttonSubtext: ctaSubtext,
    whatsappText: ctaText,
    whatsappLabel: ctaText,
    whatsappNumber: siteText,
    phoneText: siteText,
    replaceWhatsappWithSite: true,
    showWhatsapp: false,
    showSiteCta: true,
    mascotImageUrl,
    mascoteUrl: mascotImageUrl,
    removeMascotBackground: true
  };
}

async function generateAndSaveProductCreative(doc, variant = 'square', pixPercent = 17, creativeOptions = {}) {
  const product = normalizeProductForResponse(doc);
  const siteCtaOptions = normalizePosterSiteCtaOptions(creativeOptions);
  const buffer = await generateProductPosterBuffer(product, { variant, pixPercent, ...siteCtaOptions });
  const publicId = `${sanitizeIdPart(product.name || product.sku || product.id)}-${variant}-${Date.now()}`;
  const result = await uploadBufferToCloudinary(buffer, {
    folder: buildCloudinaryFolder(`posters/produtos/${variant}`),
    public_id: publicId
  });
  const poster = { variant, url: result.secure_url, public_id: result.public_id, width: result.width, height: result.height, format: result.format, siteUrl: siteCtaOptions.siteUrl, ctaText: siteCtaOptions.ctaText, createdAt: new Date().toISOString() };
  await Product.findByIdAndUpdate(doc._id, { $push: { posters: { $each: [poster], $slice: -20 } }, $set: { updatedAt: new Date() } });
  return poster;
}

function professionalCreativeInput(body = {}) {
  const product = body && typeof body.product === 'object' && body.product ? body.product : {};
  const nestedOptions = body && typeof body.options === 'object' && body.options ? body.options : {};
  const options = {
    ...body,
    ...nestedOptions,
    variant: 'whatsapp',
    template: nestedOptions.template || body.template || 'oferta'
  };
  delete options.product;
  delete options.options;
  return { product, options };
}

const PROFESSIONAL_POSTER_ROTATION_KEY = 'professional_poster_layout_rotation';
function professionalLayoutForSequence(sequence = 0) {
  const layouts = ['classic', 'showcase', 'premium'];
  return layouts[Math.floor(Math.max(0, Number(sequence) || 0) / 10) % layouts.length];
}
async function professionalPosterRotationState() {
  const saved = await getSetting(PROFESSIONAL_POSTER_ROTATION_KEY, { count: 0 });
  const count = Math.max(0, Number(saved?.count || 0));
  return { count, layoutVariant: professionalLayoutForSequence(count) };
}

app.post('/api/admin/posters/preview', adminRequired, async (req, res) => {
  try {
    const { product, options } = professionalCreativeInput(req.body || {});
    const rotation = await professionalPosterRotationState();
    options.layoutVariant = options.layoutVariant || rotation.layoutVariant;
    const buffer = await generateProductPosterBuffer(product, options);
    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': 'inline; filename="previa-cartaz-ariana.png"',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff'
    });
    return res.send(buffer);
  } catch (error) {
    console.error('[posters] erro ao gerar prévia profissional:', error);
    return res.status(500).json({ ok: false, error: error.message || 'professional_poster_preview_failed' });
  }
});

app.post('/api/admin/posters/professional', adminRequired, async (req, res) => {
  try {
    if (!isCloudinaryConfigured()) return res.status(500).json({ ok: false, error: 'Cloudinary não configurado.' });
    const { product, options } = professionalCreativeInput(req.body || {});
    const rotation = await professionalPosterRotationState();
    options.layoutVariant = options.layoutVariant || rotation.layoutVariant;
    const buffer = await generateProductPosterBuffer(product, options);
    const productName = String(product.name || product.title || 'cartaz-ariana');
    const publicId = `${sanitizeIdPart(productName)}-whatsapp-${Date.now()}`;
    const result = await uploadBufferToCloudinary(buffer, {
      folder: buildCloudinaryFolder('posters/profissionais/whatsapp'),
      public_id: publicId
    });
    const poster = {
      variant: 'whatsapp',
      template: options.template,
      layoutVariant: options.layoutVariant,
      url: result.secure_url,
      public_id: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
      createdAt: new Date().toISOString()
    };

    const productId = String(req.body?.productId || product.id || product._id || '').trim();
    const oid = normalizeObjectId(productId);
    if (oid) {
      await Product.findByIdAndUpdate(oid, {
        $push: { posters: { $each: [poster], $slice: -20 } },
        $set: { updatedAt: new Date() }
      }).catch(() => null);
    }

    await setSetting(
      PROFESSIONAL_POSTER_ROTATION_KEY,
      { count: rotation.count + 1, lastLayout: options.layoutVariant, updatedAt: new Date().toISOString() },
      String(req.admin?.email || req.admin?.id || 'admin')
    ).catch(() => null);

    return res.json({ ok: true, poster, url: poster.url, sequence: rotation.count + 1, nextLayoutChangeAt: (Math.floor(rotation.count / 10) + 1) * 10 });
  } catch (error) {
    console.error('[posters] erro ao publicar cartaz profissional:', error);
    return res.status(500).json({ ok: false, error: error.message || 'professional_poster_generate_failed' });
  }
});

app.post('/api/admin/posters/product/:id', adminRequired, async (req, res) => {
  try {
    if (!isCloudinaryConfigured()) {
      return res.status(500).json({ ok: false, error: 'Cloudinary não configurado.' });
    }

    const oid = normalizeObjectId(req.params.id);
    let doc = oid ? await Product.findById(oid) : null;
    if (!doc) doc = await Product.findOne({ $or: [{ slug: req.params.id }, { sku: req.params.id }] });
    if (!doc) return res.status(404).json({ ok: false, error: 'Produto não encontrado' });

    const variant = String(req.body?.variant || req.query?.variant || 'square').toLowerCase() === 'story' ? 'story' : 'square';
    const pixPercent = Number(req.body?.pixPercent || req.query?.pixPercent || 17);
    const poster = await generateAndSaveProductCreative(doc, variant, pixPercent, req.body || {});

    return res.json({ ok: true, productId: String(doc._id), poster, url: poster.url });
  } catch (error) {
    console.error('[posters] erro ao gerar poster do produto:', error);
    return res.status(500).json({ ok: false, error: error.message || 'poster_generate_failed' });
  }
});

app.post('/api/admin/posters/offers', adminRequired, async (req, res) => {
  try {
    const limit = Math.min(Number(req.body?.limit || req.query?.limit || 6), 8);
    const products = await Product.find({ active: { $ne: false }, isOffer: true }).sort({ updatedAt: -1, createdAt: -1 }).limit(limit);
    return res.json({ ok: true, message: 'Primeira versão instalada. Use /api/admin/posters/product/:id para gerar posters por produto.', products: products.map(normalizeProductForResponse) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'offers_poster_failed' });
  }
});


app.post('/api/admin/posters/bulk', adminRequired, async (req, res) => {
  try {
    if (!isCloudinaryConfigured()) return res.status(500).json({ ok: false, error: 'Cloudinary não configurado.' });
    const variant = String(req.body?.variant || req.query?.variant || 'square').toLowerCase() === 'story' ? 'story' : 'square';
    const limit = Math.min(Math.max(Number(req.body?.limit || req.query?.limit || 500), 1), 1000);
    const pixPercent = Number(req.body?.pixPercent || req.query?.pixPercent || 17);
    const products = await Product.find({ active: { $ne: false } }).sort({ updatedAt: -1, createdAt: -1 }).limit(limit);
    const results = [];
    for (const doc of products) {
      try {
        const poster = await generateAndSaveProductCreative(doc, variant, pixPercent, req.body || {});
        results.push({ ok: true, productId: String(doc._id), name: doc.name, url: poster.url });
      } catch (error) {
        results.push({ ok: false, productId: String(doc._id), name: doc.name, error: error.message });
      }
    }
    return res.json({ ok: true, variant, total: products.length, success: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'bulk_posters_failed' });
  }
});

app.post('/api/admin/marketing/banner-drafts/generate', adminRequired, async (req, res) => {
  try {
    if (!isCloudinaryConfigured()) return res.status(500).json({ ok: false, error: 'Cloudinary não configurado.' });
    const definitions = bannerDraftDefinitions();
    const usedIds = new Set();
    const saved = [];
    for (const def of definitions) {
      const products = await selectProductsForBanner(def, usedIds, Number(def.productLimit || 3));
      const buffer = await generateMarketingBannerBuffer({ title: def.title, subtitle: def.subtitle, products, width: def.width, height: def.height, targetSlot: def.targetSlot, group: def.group });
      const result = await uploadBufferToCloudinary(buffer, {
        folder: buildCloudinaryFolder('banners/rascunhos'),
        public_id: `draft-${def.key}-${Date.now()}`
      });
      const slot = `draft_${def.key}_${Date.now()}`;
      const doc = await Banner.create({
        slot,
        targetSlot: def.targetSlot,
        title: def.title,
        subtitle: def.subtitle,
        image: result.secure_url,
        href: def.href || (def.targetSlot.includes('categoria') ? 'categoria.html' : 'todos_produtos.html'),
        alt: def.title,
        active: false,
        status: 'draft',
        source: 'automatic',
        draftType: 'slot_banner',
        products: products.map(p => ({ id: String(p.id || p._id), name: p.name, image: p.imageUrl || p.mainImageUrl || '' })),
        sortOrder: saved.length + 1,
        device: 'all'
      });
      saved.push(doc);
    }
    return res.json({ ok: true, count: saved.length, drafts: saved.map(normalizeBannerForResponse) });
  } catch (error) {
    console.error('[marketing] erro ao gerar rascunhos:', error);
    return res.status(500).json({ ok: false, error: error.message || 'banner_drafts_generate_failed' });
  }
});

app.get('/api/admin/marketing/banner-drafts', adminRequired, async (_req, res) => {
  try {
    const rows = await Banner.find({ status: 'draft', active: false }).sort({ createdAt: -1 }).limit(100);
    return res.json({ ok: true, drafts: rows.map(normalizeBannerForResponse) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'banner_drafts_list_failed' });
  }
});

app.post('/api/admin/marketing/banner-drafts/:id/publish', adminRequired, async (req, res) => {
  try {
    const oid = normalizeObjectId(req.params.id);
    const doc = oid ? await Banner.findById(oid) : await Banner.findOne({ slot: req.params.id });
    if (!doc) return res.status(404).json({ ok: false, error: 'Rascunho não encontrado' });
    const targetSlot = String(req.body?.targetSlot || doc.targetSlot || doc.slot || '').trim();
    if (!targetSlot) return res.status(400).json({ ok: false, error: 'targetSlot_required' });
    await Banner.updateMany({ _id: { $ne: doc._id }, $or: [{ slot: targetSlot }, { targetSlot }], active: true }, { $set: { active: false, status: 'archived' } });
    doc.slot = targetSlot;
    doc.targetSlot = targetSlot;
    doc.active = true;
    doc.status = 'published';
    doc.source = doc.source || 'automatic';
    await doc.save();
    return res.json({ ok: true, banner: normalizeBannerForResponse(doc) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'banner_draft_publish_failed' });
  }
});

app.delete('/api/admin/marketing/banner-drafts/:id', adminRequired, async (req, res) => {
  try {
    const oid = normalizeObjectId(req.params.id);
    const doc = oid ? await Banner.findByIdAndDelete(oid) : await Banner.findOneAndDelete({ slot: req.params.id, status: 'draft' });
    if (!doc) return res.status(404).json({ ok: false, error: 'Rascunho não encontrado' });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'banner_draft_delete_failed' });
  }
});

app.post('/api/admin/marketing/generate-all-drafts', adminRequired, async (req, res) => {
  try {
    if (!isCloudinaryConfigured()) return res.status(500).json({ ok: false, error: 'Cloudinary não configurado.' });
    const limit = Math.min(Math.max(Number(req.body?.limit || req.query?.limit || 500), 1), 1000);
    const products = await Product.find({ active: { $ne: false } }).sort({ updatedAt: -1, createdAt: -1 }).limit(limit);
    const posters = [];
    const stories = [];
    for (const doc of products) {
      try { const poster = await generateAndSaveProductCreative(doc, 'square', Number(req.body?.pixPercent || req.query?.pixPercent || 17), req.body || {}); posters.push({ ok: true, productId: String(doc._id), url: poster.url }); } catch (error) { posters.push({ ok: false, productId: String(doc._id), error: error.message }); }
      try { const story = await generateAndSaveProductCreative(doc, 'story', Number(req.body?.pixPercent || req.query?.pixPercent || 17), req.body || {}); stories.push({ ok: true, productId: String(doc._id), url: story.url }); } catch (error) { stories.push({ ok: false, productId: String(doc._id), error: error.message }); }
    }
    const definitions = bannerDraftDefinitions();
    const usedIds = new Set();
    const drafts = [];
    for (const def of definitions) {
      const selected = await selectProductsForBanner(def, usedIds, Number(def.productLimit || 3));
      const buffer = await generateMarketingBannerBuffer({ title: def.title, subtitle: def.subtitle, products: selected, width: def.width, height: def.height, targetSlot: def.targetSlot, group: def.group });
      const result = await uploadBufferToCloudinary(buffer, { folder: buildCloudinaryFolder('banners/rascunhos'), public_id: `draft-${def.key}-${Date.now()}` });
      const doc = await Banner.create({ slot: `draft_${def.key}_${Date.now()}`, targetSlot: def.targetSlot, title: def.title, subtitle: def.subtitle, image: result.secure_url, href: def.href || (def.targetSlot.includes('categoria') ? 'categoria.html' : 'todos_produtos.html'), alt: def.title, active: false, status: 'draft', source: 'automatic', draftType: 'slot_banner', products: selected.map(p => ({ id: String(p.id || p._id), name: p.name, image: p.imageUrl || p.mainImageUrl || '' })), sortOrder: drafts.length + 1, device: 'all' });
      drafts.push(normalizeBannerForResponse(doc));
    }
    return res.json({ ok: true, products: products.length, postersSuccess: posters.filter(x => x.ok).length, storiesSuccess: stories.filter(x => x.ok).length, bannerDrafts: drafts.length, posters, stories, drafts });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'generate_all_drafts_failed' });
  }
});

app.post('/api/upload', upload.single('file'), uploadToCloudinary);
app.post('/admin/uploads', adminRequired, upload.single('file'), uploadToCloudinary);
app.post('/api/admin/uploads', adminRequired, upload.single('file'), uploadToCloudinary);

app.delete(['/api/admin/uploads','/admin/uploads'], adminRequired, async (req, res) => {
  try {
    const rawPath = String(req.query?.path || req.body?.path || '').trim();
    if (!rawPath) return res.json({ ok: true, deleted: false });

    if (/^https?:\/\//i.test(rawPath)) {
      const m = rawPath.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+(?:\?.*)?$/);
      const publicId = m ? m[1] : '';
      if (!publicId) return res.json({ ok: true, deleted: false, path: rawPath });
      const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
      return res.json({ ok: true, deleted: result?.result === 'ok' || result?.result === 'not found', path: publicId, result });
    }

    const maybePublicId = rawPath.replace(/^\/+/, '');
    if (maybePublicId.startsWith('ariana_moveis/')) {
      const result = await cloudinary.uploader.destroy(maybePublicId, { resource_type: 'image' });
      return res.json({ ok: true, deleted: result?.result === 'ok' || result?.result === 'not found', path: maybePublicId, result });
    }

    return res.json({ ok: true, deleted: false, path: rawPath });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'delete_upload_failed' });
  }
});

app.get('/api/admin/settings/:key', adminRequired, async (req, res) => {
  try {
    const key = String(req.params.key || '').trim();
    if (!key) {
      return res.status(400).json({ ok: false, error: 'key_required' });
    }

    const value = await getSetting(key, {});
    return res.json({ ok: true, key, value: value || {} });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'settings_read_failed' });
  }
});

app.patch('/api/admin/settings/:key', adminRequired, async (req, res) => {
  try {
    const key = String(req.params.key || '').trim();
    if (!key) {
      return res.status(400).json({ ok: false, error: 'key_required' });
    }

    const current = await getSetting(key, {});
    const incoming = req.body || {};
    const merged = {
      ...(current || {}),
      ...(incoming || {}),
      updatedAt: new Date().toISOString()
    };

    await setSetting(key, merged, String((req.user && (req.user._id || req.user.id || req.user.uid)) || 'admin'));
    return res.json({ ok: true, key, value: merged });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'settings_save_failed' });
  }
});

app.put('/api/admin/settings/:key', adminRequired, async (req, res) => {
  try {
    const key = String(req.params.key || '').trim();
    if (!key) {
      return res.status(400).json({ ok: false, error: 'key_required' });
    }

    const current = await getSetting(key, {});
    const incoming = req.body || {};
    const merged = {
      ...(current || {}),
      ...(incoming || {}),
      updatedAt: new Date().toISOString()
    };

    await setSetting(key, merged, String((req.user && (req.user._id || req.user.id || req.user.uid)) || 'admin'));
    return res.json({ ok: true, key, value: merged });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'settings_save_failed' });
  }
});



app.delete(['/api/admin/uploads','/admin/uploads'], adminRequired, async (req, res) => {
  try {
    const rawPath = String(req.query?.path || req.body?.path || '').trim();
    if (!rawPath) return res.json({ ok: true, deleted: false });

    if (/^https?:\/\//i.test(rawPath)) {
      const m = rawPath.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+(?:\?.*)?$/);
      const publicId = m ? m[1] : '';
      if (!publicId) return res.json({ ok: true, deleted: false, path: rawPath });
      const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
      return res.json({ ok: true, deleted: result?.result === 'ok' || result?.result === 'not found', path: publicId, result });
    }

    const maybePublicId = rawPath.replace(/^\/+/, '');
    if (maybePublicId.startsWith('ariana_moveis/')) {
      const result = await cloudinary.uploader.destroy(maybePublicId, { resource_type: 'image' });
      return res.json({ ok: true, deleted: result?.result === 'ok' || result?.result === 'not found', path: maybePublicId, result });
    }

    const rel = safeUploadFolder(rawPath);
    if (!rel) return res.json({ ok: true, deleted: false });

    const abs = path.join(uploadsDir, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) fs.unlinkSync(abs);
    return res.json({ ok: true, deleted: true, path: rel });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'delete_upload_failed' });
  }
});

const adminCollectionMap = {
  products: Product,
  categories: Category,
  orders: Order,
  users: User,
  banners: Banner,
  settings: Setting,
  atendimentos: Ticket,
  tickets: Ticket,
  notifications: Notification,
  alerts: OperationalAlert,
  sellers: Seller,
};

function buildAdminQuery(modelName, req) {
  const q = {};
  if (modelName === 'products') {
    if (req.query.where_category) q.category = String(req.query.where_category);
    if (req.query.where_sellerId) q.sellerId = String(req.query.where_sellerId);
  }
  if (modelName === 'orders' && req.query.where_status) q.status = String(req.query.where_status);
  if ((modelName === 'atendimentos' || modelName === 'tickets') && req.query.where_status) q.status = String(req.query.where_status);
  return q;
}


// ============================================================
// EXPORTAÇÃO DE PRODUTOS - PDF / EXCEL PELO PAINEL ADMIN
// Retorna todos os produtos cadastrados para relatórios internos.
// ============================================================
app.get('/api/admin/products/export/all', adminRequired, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 10000), 20000);
    const rows = await Product.find({})
      .sort({ categoryName: 1, category: 1, name: 1, updatedAt: -1 })
      .limit(limit);

    const items = rows.map((doc) => normalizeProductForResponse(doc));

    return res.json({
      ok: true,
      total: items.length,
      generatedAt: new Date().toISOString(),
      items
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'products_export_failed' });
  }
});

// IMPORTANTE:
// Este CRUD é um fallback genérico. Quando a coleção não pertence ao mapa,
// a requisição deve seguir para as rotas específicas registradas em outros
// módulos, como /api/admin/financeiro/status.
app.get('/api/admin/:collection', adminRequired, async (req, res, next) => {
  const key = String(req.params.collection || '').trim().toLowerCase();
  if (['login','me','uploads','stats','runtime','shipping','alerts','audit-logs','orders','notifications'].includes(key)) return next();
  const Model = adminCollectionMap[key];
  if (!Model) return next();
  try {
    const query = buildAdminQuery(key, req);
    const limit = Math.min(Number(req.query.limit || 500), 1000);
    const sortBy = String(req.query.sortBy || 'createdAt');
    const sortDir = String(req.query.sortDir || 'desc').toLowerCase() === 'asc' ? 1 : -1;
    let rows = await Model.find(query).sort({ [sortBy]: sortDir }).limit(limit);
    if (key === 'settings') rows = rows.map((doc) => ({ id: doc.key, key: doc.key, ...(doc.value || {}), updatedAt: doc.updatedAt, createdAt: doc.createdAt }));
    else rows = rows.map((doc) => key === 'products' ? normalizeProductForResponse(doc) : toJSON(doc));
    return res.json(rows);
  } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'admin_list_failed' }); }
});

app.get('/api/admin/:collection/:id', adminRequired, async (req, res, next) => {
  const key = String(req.params.collection || '').trim().toLowerCase();
  const Model = adminCollectionMap[key];
  if (!Model) return next();
  try {
    let doc;
    if (key === 'settings') {
      doc = await Setting.findOne({ key: req.params.id });
      if (!doc) return res.status(404).json({ ok: false, error: 'not_found' });
      return res.json({ id: doc.key, key: doc.key, ...(doc.value || {}), updatedAt: doc.updatedAt, createdAt: doc.createdAt });
    }
    const oid = normalizeObjectId(req.params.id);
    doc = oid ? await Model.findById(oid) : null;
    if (!doc && ['products'].includes(key)) doc = await Model.findOne({ $or: [{ slug: req.params.id }, { sku: req.params.id }] });
    if (!doc) return res.status(404).json({ ok: false, error: 'not_found' });
    return res.json(key === 'products' ? normalizeProductForResponse(doc) : toJSON(doc));
  } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'admin_read_failed' }); }
});

app.post('/api/admin/:collection', adminRequired, async (req, res, next) => {
  const key = String(req.params.collection || '').trim().toLowerCase();
  const Model = adminCollectionMap[key];
  if (!Model) return next();
  try {
    let doc;
    if (key === 'products') doc = await Product.create(productPayloadFromBody(req.body || {}));
    else if (key === 'settings') {
      const settingKey = String(req.body?.key || req.body?.id || '').trim() || uid('setting');
      const value = { ...(req.body || {}) }; delete value.key; delete value.id;
      await Setting.findOneAndUpdate({ key: settingKey }, { $set: { key: settingKey, value, updatedBy: String(req.admin?.email || 'admin') } }, { upsert: true, new: true });
      const saved = await Setting.findOne({ key: settingKey });
      return res.json({ id: saved.key, key: saved.key, ...(saved.value || {}), updatedAt: saved.updatedAt, createdAt: saved.createdAt });
    } else if (key === 'atendimentos' || key === 'tickets') {
      doc = await Ticket.create({ protocolo: req.body?.protocolo || `AT-${Date.now()}`, nome: req.body?.nome || req.body?.name || '', email: req.body?.email || '', telefone: req.body?.telefone || req.body?.phone || '', tipo: req.body?.tipo || 'Atendimento', assunto: req.body?.assunto || '', mensagem: req.body?.mensagem || req.body?.message || '', status: req.body?.status || 'Novo', origem: req.body?.origem || 'admin', metadata: req.body?.metadata || {} });
    } else doc = await Model.create(req.body || {});
    return res.json(key === 'products' ? normalizeProductForResponse(doc) : toJSON(doc));
  } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'admin_create_failed' }); }
});

app.patch('/api/admin/:collection/:id', adminRequired, async (req, res, next) => {
  const key = String(req.params.collection || '').trim().toLowerCase();
  const Model = adminCollectionMap[key];
  if (!Model) return next();
  try {
    if (key === 'settings') {
      const existing = await Setting.findOne({ key: req.params.id });
      const merged = { ...((existing && existing.value) || {}), ...(req.body || {}) };
      const saved = await Setting.findOneAndUpdate({ key: req.params.id }, { $set: { key: req.params.id, value: merged, updatedBy: String(req.admin?.email || 'admin') } }, { upsert: true, new: true });
      return res.json({ id: saved.key, key: saved.key, ...(saved.value || {}), updatedAt: saved.updatedAt, createdAt: saved.createdAt });
    }
    const oid = normalizeObjectId(req.params.id);
    if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' });
    const existingDoc = await Model.findById(oid);
    if (!existingDoc) return res.status(404).json({ ok: false, error: 'not_found' });
    const beforeObj = toJSON(existingDoc);
    const payload = key === 'products' ? productPayloadFromBody({ ...(req.body || {}) }, existingDoc) : (req.body || {});
    const doc = await Model.findByIdAndUpdate(oid, { $set: payload }, { new: true, runValidators: true });

    if (key === 'orders') {
      const afterObj = toJSON(doc);
      const changed = changedKeys(beforeObj, afterObj);
      const statusChanged = String(beforeObj.status || '') !== String(afterObj.status || '') || String(beforeObj.statusLabel || '') !== String(afterObj.statusLabel || '');
      const trackingChanged = String(beforeObj.trackingCode || '') !== String(afterObj.trackingCode || '');

      if (statusChanged || trackingChanged) {
        await createAdminNotification({
          type: 'order_updated',
          title: '📦 Pedido atualizado',
          message: `Pedido ${afterObj.id || afterObj._id} atualizado${afterObj.statusLabel || afterObj.status ? ` para ${afterObj.statusLabel || afterObj.status}` : ''}${afterObj.trackingCode ? ` - Rastreio: ${afterObj.trackingCode}` : ''}`,
          relatedId: String(afterObj.id || afterObj._id),
          severity: statusChanged ? 'info' : 'success'
        });
        await createSellerOrderNotifications(afterObj, {
          type: 'seller_order_updated',
          title: '📦 Pedido atualizado pela Ariana Móveis',
          message: `Pedido #${String(afterObj.id || afterObj._id).slice(-8).toUpperCase()} atualizado${afterObj.statusLabel || afterObj.status ? ` para ${afterObj.statusLabel || afterObj.status}` : ''}${afterObj.trackingCode ? ` - Rastreio: ${afterObj.trackingCode}` : ''}`,
          severity: statusChanged ? 'info' : 'success',
          origin: 'admin_generic_orders_route'
        });
      }

      await writeAuditLog({
        scope: 'admin_orders',
        eventType: 'admin_order_updated',
        orderId: String(afterObj.id || afterObj._id),
        status: 'success',
        changedKeys: changed,
        metadata: { actor: req.admin?.email || req.admin?.id || 'admin' }
      }).catch(() => null);

      // O painel admin usa esta rota genérica: PATCH /api/admin/orders/:id.
      // Por isso o WhatsApp precisa ser chamado aqui também.
      const customerWhatsapp = (statusChanged || trackingChanged)
        ? await waMaybeNotifyOrderStatusChange(String(afterObj.id || afterObj._id), beforeObj, afterObj, 'admin_generic_orders_route_customer')
        : { skipped: true, reason: 'no_status_or_tracking_change' };

      const adminWhatsapp = (statusChanged || trackingChanged)
        ? await waNotifyAdminOrderStatusChange(String(afterObj.id || afterObj._id), beforeObj, afterObj, 'admin_generic_orders_route_admin')
        : { skipped: true, reason: 'no_status_or_tracking_change' };

      return res.json({ ok: true, order: afterObj, whatsapp: customerWhatsapp, adminWhatsapp });
    }

    return res.json(key === 'products' ? normalizeProductForResponse(doc) : toJSON(doc));
  } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'admin_patch_failed' }); }
});

app.put('/api/admin/:collection/:id', adminRequired, async (req, res) => {
  req.method = 'PATCH';
  return app._router.handle(req, res, () => {});
});

app.delete('/api/admin/:collection/:id', adminRequired, async (req, res, next) => {
  const key = String(req.params.collection || '').trim().toLowerCase();
  const Model = adminCollectionMap[key];
  if (!Model) return next();
  try {
    if (key === 'settings') { await Setting.deleteOne({ key: req.params.id }); return res.json({ ok: true }); }
    const oid = normalizeObjectId(req.params.id);
    if (!oid) return res.status(400).json({ ok: false, error: 'ID inválido' });
    await Model.findByIdAndDelete(oid);
    return res.json({ ok: true });
  } catch (error) { return res.status(500).json({ ok: false, error: error.message || 'admin_delete_failed' }); }
});


}
