// ============================================================
// ROTAS DE ATENDIMENTO / BOTS SAC-FINANCEIRO - ADMIN
// Extraído de legacyRoutes.js na Etapa 9.
// Objetivo: reduzir legacyRoutes.js sem alterar endpoints, regras ou respostas.
// ============================================================

export default function registerAdminAtendimentoRoutes(app, context = {}) {
  const {
    Ticket,
    Notification,
    OperationalAlert,
    adminRequired,
    mongoose,
    fs,
    toJSON,
    cleanPhone
  } = context;

  const BUILD_ID = 'enterprise-mongo-2026-04-02';

  const BOT_API_TOKEN = String(
    process.env.BOT_API_TOKEN ||
    process.env.FINANCEIRO_BOT_SECRET ||
    process.env.SAC_BOT_SECRET ||
    ''
  ).trim();

  function botAccessRequired(req, res, next) {
    const incomingToken = String(
      req.headers['x-bot-token'] ||
      req.headers['x-api-key'] ||
      req.query.token ||
      ''
    ).trim();

    if (BOT_API_TOKEN && incomingToken !== BOT_API_TOKEN) {
      return res.status(401).json({ ok: false, error: 'Token do bot inválido' });
    }

    return next();
  }

  const cleanPhoneSafe = typeof cleanPhone === 'function'
    ? cleanPhone
    : (value = '') => String(value || '').replace(/\D/g, '');

  // ============================================================
  // DASHBOARD DE ATENDIMENTO - ADMIN
  // Rotas usadas pelo admin_painel.htm na aba Atendimentos.
  // Mantém compatibilidade com os Tickets do site e, quando existir,
  // também lê arquivos locais do monitor de atendimento.
  // ============================================================
  function readLocalJsonSafe(filePath, fallback) {
    try {
      if (!fs.existsSync(filePath)) return fallback;
      const raw = fs.readFileSync(filePath, 'utf8').trim();
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (_error) {
      return fallback;
    }
  }

  function normalizeTicketForAdmin(ticketDoc = {}) {
    const ticket = toJSON(ticketDoc) || ticketDoc || {};
    return {
      ...ticket,
      id: String(ticket._id || ticket.id || ''),
      protocolo: ticket.protocolo || ticket.protocol || '',
      tipo: ticket.tipo || ticket.department || ticket.departamento || 'Atendimento',
      status: ticket.status || 'Novo',
      nome: ticket.nome || ticket.name || '',
      email: ticket.email || '',
      telefone: ticket.telefone || ticket.phone || '',
      mensagem: ticket.mensagem || ticket.message || '',
      createdAt: ticket.createdAt || ticket.data || null,
      updatedAt: ticket.updatedAt || null
    };
  }

  app.get('/api/admin/atendimentos', adminRequired, async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(Number(req.query.limit || 500), 1000));
      const rows = await Ticket.find().sort({ createdAt: -1 }).limit(limit);
      return res.json(rows.map(normalizeTicketForAdmin));
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar atendimentos' });
    }
  });

  app.patch('/api/admin/atendimentos/:id', adminRequired, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const status = String(req.body?.status || '').trim();
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ ok: false, error: 'Atendimento inválido' });
      }
      const update = {};
      if (status) update.status = status;
      const doc = await Ticket.findByIdAndUpdate(id, { $set: update }, { new: true });
      if (!doc) return res.status(404).json({ ok: false, error: 'Atendimento não encontrado' });
      return res.json({ ok: true, atendimento: normalizeTicketForAdmin(doc) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao atualizar atendimento' });
    }
  });



  // ============================================================
  // SINCRONIZAÇÃO DOS BOTS COM O PAINEL DE ATENDIMENTO
  // ============================================================
  app.post('/api/bot/atendimento/evento', botAccessRequired, async (req, res) => {
    try {
      const body = req.body || {};
      const protocolo = String(body.protocolo || body.protocol || '').trim();
      const telefone = cleanPhoneSafe(body.telefone || body.phone || body.number || '');
      const setor = String(body.setor || body.sector || 'sac').toLowerCase();
      const tipo = setor.includes('fin') ? 'Financeiro' : 'SAC';
      const status = String(body.status || 'Aguardando atendimento').trim();
      const mensagem = String(body.mensagem || body.message || '').trim();
      const nome = String(body.nome || body.name || '').trim();

      if (!protocolo && !telefone) {
        return res.status(400).json({ ok: false, error: 'Informe protocolo ou telefone' });
      }

      const doc = await Ticket.findOneAndUpdate(
        { protocolo: protocolo || telefone },
        {
          $set: {
            protocolo: protocolo || telefone,
            tipo,
            telefone,
            nome,
            mensagem,
            status,
            origem: 'whatsapp_bot',
            metadata: {
              ...(body.metadata || {}),
              setor,
              phone: telefone,
              source: 'bot'
            }
          }
        },
        { upsert: true, new: true }
      );

      return res.json({ ok: true, atendimento: normalizeTicketForAdmin(doc) });
    } catch (error) {
      console.error('[bot atendimento evento]', error);
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao registrar atendimento' });
    }
  });

  app.post('/api/bot/atendimento/avaliacao', botAccessRequired, async (req, res) => {
    try {
      const body = req.body || {};
      const protocolo = String(body.protocolo || body.protocol || '').trim();
      const telefone = cleanPhoneSafe(body.telefone || body.phone || body.number || '');
      const nota = Number(body.nota || body.rating || 0);
      const setor = String(body.setor || body.sector || '').toLowerCase();

      if (!nota || nota < 1 || nota > 5) {
        return res.status(400).json({ ok: false, error: 'Nota inválida' });
      }

      await Notification.create({
        type: 'atendimento_avaliacao',
        title: nota <= 3 ? '⚠️ Avaliação baixa recebida' : '⭐ Avaliação recebida',
        message: `Nota ${nota} recebida no ${setor || 'atendimento'}`,
        status: 'unread',
        relatedId: protocolo,
        severity: nota <= 3 ? 'high' : 'info',
        audience: 'admin',
        metadata: { protocolo, telefone, nota, setor, source: 'bot' }
      });if (protocolo || telefone) {
        await Ticket.findOneAndUpdate(
          protocolo ? { protocolo } : { telefone },
          {
            $set: {
              status: 'Avaliado',
              metadata: { protocolo, telefone, nota, setor, source: 'bot' }
            }
          },
          { new: true }
        ).catch(() => null);
      }

      return res.json({ ok: true });
    } catch (error) {
      console.error('[bot atendimento avaliacao]', error);
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao registrar avaliação' });
    }
  });

  app.post('/api/bot/atendimento/alerta', botAccessRequired, async (req, res) => {
    try {
      const body = req.body || {};
      const protocolo = String(body.protocolo || body.protocol || '').trim();
      const telefone = cleanPhoneSafe(body.telefone || body.phone || body.number || '');
      const setor = String(body.setor || body.sector || '').toLowerCase();
      const mensagem = String(body.mensagem || body.message || '').trim();

      await OperationalAlert.create({
        alertId: `bot_critical_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        type: 'atendimento_critico',
        severity: 'critical',
        status: 'open',
        title: '🚨 Alerta crítico de atendimento',
        message: mensagem || 'Cliente enviou mensagem crítica',
        entityKey: protocolo || telefone || String(Date.now()),
        metadata: { protocolo, telefone, setor, source: 'bot' },
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        buildId: BUILD_ID
      });

      return res.json({ ok: true });
    } catch (error) {
      console.error('[bot atendimento alerta]', error);
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao registrar alerta' });
    }
  });


  app.get('/api/admin/atendimento/dashboard', adminRequired, async (_req, res) => {
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const [openTickets, todaysTickets, criticalAlerts, notifications] = await Promise.all([
        Ticket.find({ status: { $nin: ['Resolvido', 'Fechado', 'Finalizado'] } }).sort({ createdAt: -1 }).limit(1000),
        Ticket.find({ createdAt: { $gte: startOfDay } }).sort({ createdAt: -1 }).limit(1000),
        OperationalAlert.countDocuments({ createdAt: { $gte: startOfDay }, severity: { $in: ['high', 'critical'] } }).catch(() => 0),
        Notification.find({ createdAt: { $gte: startOfDay } }).sort({ createdAt: -1 }).limit(200).catch(() => [])
      ]);

      const humanMode = readLocalJsonSafe('/root/human-mode.json', {});
      const avaliacoes = readLocalJsonSafe('/root/avaliacoes.json', []);

      const humanValues = Object.values(humanMode || {});
      const queueSacFile = humanValues.filter((x) => String(x?.sector || '').toLowerCase() === 'sac').length;
      const queueFinFile = humanValues.filter((x) => String(x?.sector || '').toLowerCase() === 'financeiro').length;

      const openNormalized = openTickets.map(normalizeTicketForAdmin);
      const sacLocal = openNormalized.filter((x) => String(x.tipo || '').toLowerCase().includes('sac')).length;
      const finLocal = openNormalized.filter((x) => String(x.tipo || '').toLowerCase().includes('fin')).length;

      const ratingsToday = Array.isArray(avaliacoes)
        ? avaliacoes.filter((a) => String(a?.data || '').slice(0, 10) === new Date().toISOString().slice(0, 10))
        : [];

      const ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const item of ratingsToday) {
        const nota = Number(item?.nota);
        if (ratingCounts[nota] !== undefined) ratingCounts[nota] += 1;
      }

      const media = ratingsToday.length
        ? Number((ratingsToday.reduce((sum, item) => sum + Number(item?.nota || 0), 0) / ratingsToday.length).toFixed(2))
        : null;

      const criticalNotifications = notifications.filter((n) => {
        const text = `${n.title || ''} ${n.message || ''} ${JSON.stringify(n.metadata || {})}`.toLowerCase();
        return text.includes('procon') || text.includes('processo') || text.includes('advogado') || text.includes('chargeback') || text.includes('fraude') || text.includes('reclama');
      }).length;

      return res.json({
        ok: true,
        updatedAt: new Date().toISOString(),
        queue: {
          sac: queueSacFile || sacLocal,
          financeiro: queueFinFile || finLocal,
          total: (queueSacFile + queueFinFile) || openNormalized.length
        },
        ratings: {
          media: media === null ? '—' : media,
          totalHoje: ratingsToday.length,
          counts: ratingCounts
        },
        critical: {
          hoje: Number(criticalAlerts || 0) + Number(criticalNotifications || 0)
        },
        tempoMedioResposta: '—',
        totals: {
          atendimentosHoje: todaysTickets.length,
          abertos: openNormalized.length
        }
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar dashboard de atendimento' });
    }
  });


}
