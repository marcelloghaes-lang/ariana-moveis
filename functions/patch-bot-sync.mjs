import fs from "fs";

const path = "./server.js";
let txt = fs.readFileSync(path, "utf8");

const marker = "app.get('/api/admin/atendimento/dashboard'";
const insert = `

// ============================================================
// SINCRONIZAÇÃO DOS BOTS COM O PAINEL DE ATENDIMENTO
// ============================================================
app.post('/api/bot/atendimento/evento', botAccessRequired, async (req, res) => {
  try {
    const body = req.body || {};
    const protocolo = String(body.protocolo || body.protocol || '').trim();
    const telefone = cleanPhone(body.telefone || body.phone || body.number || '');
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
    const telefone = cleanPhone(body.telefone || body.phone || body.number || '');
    const nota = Number(body.nota || body.rating || 0);
    const setor = String(body.setor || body.sector || '').toLowerCase();

    if (!nota || nota < 1 || nota > 5) {
      return res.status(400).json({ ok: false, error: 'Nota inválida' });
    }

    await Notification.create({
      type: 'atendimento_avaliacao',
      title: nota <= 3 ? '⚠️ Avaliação baixa recebida' : '⭐ Avaliação recebida',
      message: \`Nota \${nota} recebida no \${setor || 'atendimento'}\`,
      status: 'unread',
      relatedId: protocolo,
      severity: nota <= 3 ? 'high' : 'info',
      audience: 'admin',
      metadata: { protocolo, telefone, nota, setor, source: 'bot' }
    });

    if (protocolo || telefone) {
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
    const telefone = cleanPhone(body.telefone || body.phone || body.number || '');
    const setor = String(body.setor || body.sector || '').toLowerCase();
    const mensagem = String(body.mensagem || body.message || '').trim();

    await OperationalAlert.create({
      alertId: \`bot_critical_\${Date.now()}_\${Math.random().toString(16).slice(2)}\`,
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

`;

if (!txt.includes("/api/bot/atendimento/evento")) {
  txt = txt.replace(marker, insert + "\n" + marker);
}

fs.writeFileSync(path, txt, "utf8");
console.log("Rotas de sincronização dos bots adicionadas.");
