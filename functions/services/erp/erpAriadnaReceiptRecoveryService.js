import mongoose from 'mongoose';
import { createErpPaymentReceiptService } from './erpPaymentReceiptService.js';

const CUSTOMER_NAME = 'Ariadna Santos Sardinha';
const CUSTOMER_PHONE = '+17746022981';
const WINDOW_MS = 6 * 60 * 60 * 1000;

const clean = (value = '', max = 500) => String(value ?? '').trim().slice(0, max);
const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function paymentIsRecent(payment = {}, since = new Date(0)) {
  const id = clean(payment?.id, 120);
  const match = id.match(/(?:^|-)PAY-(\d{13})(?:-|$)/i) || id.match(/^PAY-(\d{13})-/i);
  if (match) {
    const ts = Number(match[1]);
    if (Number.isFinite(ts) && ts >= since.getTime()) return true;
  }
  const at = new Date(payment?.at || payment?.paidAt || 0);
  return !Number.isNaN(at.getTime()) && at >= since;
}

export function createErpAriadnaReceiptRecoveryService(context = {}) {
  const Receipt = context.CrediarioRecibo;
  const paymentReceipts = createErpPaymentReceiptService(context);
  const actor = { name: 'Recuperação automática de comprovantes' };

  async function sendExistingUnsent(since) {
    if (!Receipt) return { found: 0, sent: [], failed: [] };
    const rx = new RegExp('^' + escapeRegex(CUSTOMER_NAME) + '$', 'i');
    const rows = await Receipt.find({
      clienteNome: rx,
      enviadoWhatsapp: { $ne: true },
      $or: [
        { createdAt: { $gte: since } },
        { dataPagamento: { $gte: since } }
      ]
    }).sort({ createdAt: 1 });

    const sent = [];
    const failed = [];
    for (const receipt of rows) {
      try {
        const result = await paymentReceipts.savePhoneAndSend({
          receiptId: String(receipt._id),
          phone: CUSTOMER_PHONE,
          referenceRaw: '',
          actor
        });
        sent.push({
          id: String(receipt._id),
          recibo: clean(receipt.recibo, 100),
          ok: result?.whatsappEnviado === true
        });
      } catch (error) {
        failed.push({
          id: String(receipt._id),
          recibo: clean(receipt.recibo, 100),
          error: clean(error?.message || error, 400)
        });
      }
    }
    return { found: rows.length, sent, failed };
  }

  async function rebuildMissingFromRecentPayments(since) {
    const Entry = mongoose.models.ErpFinancialEntry;
    if (!Entry) return { entries: 0, payments: 0, deliveries: [], failed: [] };

    const rx = new RegExp('^' + escapeRegex(CUSTOMER_NAME) + '$', 'i');
    const entries = await Entry.find({
      direction: 'receivable',
      personName: rx,
      updatedAt: { $gte: since }
    }).lean();

    const deliveries = [];
    const failed = [];
    let payments = 0;

    for (const entry of entries) {
      const recentPayments = (Array.isArray(entry?.payments) ? entry.payments : [])
        .filter((payment) => paymentIsRecent(payment, since));

      for (const payment of recentPayments) {
        payments += 1;
        try {
          const result = await paymentReceipts.afterLedgerReceive({
            entry: { ...entry, personPhone: CUSTOMER_PHONE },
            payment,
            actor
          });
          deliveries.push({
            entryId: String(entry._id),
            paymentId: clean(payment?.id, 120),
            recibo: clean(result?.receipt?.recibo, 100),
            whatsappEnviado: result?.whatsappEnviado === true,
            alreadySent: result?.whatsapp?.alreadySent === true,
            error: clean(result?.whatsapp?.error, 300)
          });
        } catch (error) {
          failed.push({
            entryId: String(entry._id),
            paymentId: clean(payment?.id, 120),
            error: clean(error?.message || error, 400)
          });
        }
      }
    }

    return { entries: entries.length, payments, deliveries, failed };
  }

  async function run() {
    if (mongoose.connection.readyState !== 1) {
      return { skipped: true, reason: 'mongo_not_ready' };
    }
    if (!Receipt || !paymentReceipts.enabled) {
      return { skipped: true, reason: 'receipt_service_unavailable' };
    }

    const since = new Date(Date.now() - WINDOW_MS);

    // Primeiro reenvia comprovantes que já existem e ficaram pendentes.
    const existing = await sendExistingUnsent(since);

    // Depois reconstrói somente comprovantes ligados a pagamentos feitos nas
    // últimas horas. O hash do serviço de recibos impede duplicidade.
    const rebuilt = await rebuildMissingFromRecentPayments(since);

    // Uma última passagem cobre recibos criados na etapa anterior cujo primeiro
    // envio tenha sido interrompido pela reinicialização do serviço.
    const finalRetry = await sendExistingUnsent(since);

    const summary = {
      customer: CUSTOMER_NAME,
      since: since.toISOString(),
      existingFound: existing.found,
      existingSent: existing.sent.length,
      rebuiltEntries: rebuilt.entries,
      recentPayments: rebuilt.payments,
      rebuiltDelivered: rebuilt.deliveries.filter((item) => item.whatsappEnviado || item.alreadySent).length,
      finalFound: finalRetry.found,
      finalSent: finalRetry.sent.length,
      failures: [...existing.failed, ...rebuilt.failed, ...finalRetry.failed]
    };

    console.log('[erp-ariadna-receipt-recovery]', JSON.stringify(summary));
    if (rebuilt.deliveries.length) {
      console.log('[erp-ariadna-receipt-recovery][deliveries]', JSON.stringify(rebuilt.deliveries));
    }
    return summary;
  }

  function start() {
    if (globalThis.__erpAriadnaReceiptRecoveryStarted) return;
    globalThis.__erpAriadnaReceiptRecoveryStarted = true;

    let attempts = 0;
    const tryRun = async () => {
      attempts += 1;
      try {
        const result = await run();
        if (!result?.skipped) return;
        if (attempts >= 20) {
          console.warn('[erp-ariadna-receipt-recovery] não executado:', result?.reason || 'indisponível');
          return;
        }
      } catch (error) {
        console.error('[erp-ariadna-receipt-recovery]', error?.message || error);
        if (attempts >= 20) return;
      }
      const timer = setTimeout(tryRun, 3000);
      timer.unref?.();
    };

    const timer = setTimeout(tryRun, 1500);
    timer.unref?.();
  }

  return { run, start };
}

export default createErpAriadnaReceiptRecoveryService;
