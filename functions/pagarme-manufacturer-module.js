/* eslint-disable */
/**
 * Módulo Pagar.me para priorizar vendas de fabricantes
 * e manter Mercado Pago apenas para sellers comuns.
 *
 * Como integrar no seu functions/index.js:
 *
 * 1) No topo do arquivo:
 * const initPagarmeManufacturerModule = require('./pagarme-manufacturer-module');
 *
 * 2) Dentro de buildApp(), depois de criar app / db / admin / axios e helpers:
 * initPagarmeManufacturerModule({
 *   app,
 *   admin,
 *   db,
 *   axios,
 *   envFirst,
 *   mergeOrder,
 *   writeAuditLog,
 * });
 */
module.exports = function initPagarmeManufacturerModule(ctx) {
  const { app, admin, db, axios, envFirst, mergeOrder, writeAuditLog } = ctx;

  if (!app || !db || !admin || !axios || !envFirst) {
    throw new Error('initPagarmeManufacturerModule: contexto incompleto');
  }

  const PAGARME_BASE = String(envFirst('PAGARME_API_BASE') || 'https://api.pagar.me/core/v5').trim();
  const PAGARME_SECRET_KEY = String(envFirst('PAGARME_SECRET_KEY', 'PAGARME_SECRET_KEY_TEST', 'PAGARME_API_KEY') || '').trim();
  const PAGARME_MARKETPLACE_RECIPIENT_ID = String(envFirst('PAGARME_MARKETPLACE_RECIPIENT_ID') || '').trim();
  const PAGARME_DEFAULT_SOFT_DESCRIPTOR = String(envFirst('PAGARME_SOFT_DESCRIPTOR') || 'ARIANA MOVEIS').trim().slice(0, 13);
  const PAGARME_WEBHOOK_TOKEN = String(envFirst('PAGARME_WEBHOOK_TOKEN') || '').trim();

  function toCents(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100);
  }

  function digits(v) {
    return String(v || '').replace(/\D/g, '');
  }

  function pickManufacturer(order) {
    return String(
      order?.manufacturer ||
      order?.fabricante ||
      order?.orderIntegration?.manufacturer ||
      order?.integrationSnapshot?.manufacturer ||
      order?.manufacturerDispatch?.manufacturer ||
      order?.sellerType === 'manufacturer' ? order?.sellerId : ''
    || '').trim().toLowerCase();
  }

  function isManufacturerPriorityOrder(order) {
    if (!order || typeof order !== 'object') return false;

    const explicitProvider = String(order?.paymentProvider || order?.payment_provider || '').trim().toLowerCase();
    if (explicitProvider === 'pagarme') return true;
    if (explicitProvider === 'mercadopago') return false;

    if (order?.sellerType === 'manufacturer' || order?.vendedor_tipo === 'manufacturer') return true;

    const manufacturer = pickManufacturer(order);
    if (manufacturer && manufacturer !== 'generic') return true;

    const integrationManufacturer = String(order?.orderIntegration?.manufacturer || order?.integrationSnapshot?.manufacturer || '').trim().toLowerCase();
    if (integrationManufacturer && integrationManufacturer !== 'generic') return true;

    return false;
  }

  async function getSellerDoc(sellerId) {
    const id = String(sellerId || '').trim();
    if (!id) return null;
    const snap = await db.collection('sellers').doc(id).get();
    if (!snap.exists) return null;
    return { id: snap.id, data: snap.data() || {}, ref: snap.ref };
  }

  async function resolveRecipientIdForManufacturerOrder(order) {
    const sellerId = String(order?.sellerId || order?.seller_id || order?.vendedor_id || '').trim();
    const seller = await getSellerDoc(sellerId);
    const sellerData = seller?.data || {};

    const recipientId = String(
      order?.pagarme_recipient_id ||
      order?.recipient_id ||
      sellerData?.pagarme_recipient_id ||
      sellerData?.recipient_id ||
      ''
    ).trim();

    return {
      seller,
      sellerId,
      recipientId,
    };
  }

  function buildCustomer(order) {
    const customer = order?.customer || {};
    const shipping = order?.shippingAddress || order?.shipping_address || {};
    const fullName = String(
      customer?.nome || order?.customer_name || order?.nome || 'Cliente Ariana'
    ).trim();
    const nameParts = fullName.split(/\s+/).filter(Boolean);
    const firstName = nameParts[0] || 'Cliente';
    const lastName = nameParts.slice(1).join(' ') || 'Ariana';

    return {
      name: fullName,
      email: String(customer?.email || order?.email || 'cliente@exemplo.com').trim().toLowerCase(),
      document: digits(customer?.cpf || order?.cpf || ''),
      type: 'individual',
      phones: {
        mobile_phone: {
          country_code: '55',
          area_code: digits(customer?.telefone || order?.telefone || '').slice(0, 2) || '31',
          number: digits(customer?.telefone || order?.telefone || '').slice(2) || '999999999',
        },
      },
      address: {
        line_1: `${String(shipping?.logradouro || '').trim()}, ${String(shipping?.numero || 'S/N').trim()}`,
        line_2: String(shipping?.complemento || '').trim() || null,
        zip_code: digits(shipping?.cep || ''),
        city: String(shipping?.cidade || '').trim(),
        state: String(shipping?.uf || '').trim().toUpperCase(),
        country: 'BR',
      },
      metadata: {
        first_name: firstName,
        last_name: lastName,
      },
    };
  }

  function buildItems(order) {
    const items = Array.isArray(order?.items) && order.items.length ? order.items : [];
    return items.map((it, index) => ({
      amount: toCents(it?.unitPrice ?? it?.price ?? 0),
      description: String(it?.nome || it?.name || `Item ${index + 1}`).trim(),
      quantity: Math.max(1, Number(it?.quantity || 1) || 1),
      code: String(it?.sku_fabricante || it?.sku || `SKU-${index + 1}`).trim(),
    }));
  }

  function buildSplitRules({ order, recipientId }) {
    const subtotal = Number(order?.billing?.subtotal || 0);
    const total = Number(order?.billing?.total || subtotal || 0);
    const marketplaceCommission = Number(order?.marketplaceCommissionRate || 0.12);
    const manufacturerPercent = Math.max(0, Math.min(100, (1 - marketplaceCommission) * 100));
    const marketplacePercent = Math.max(0, Math.min(100, marketplaceCommission * 100));

    const split = [];

    if (recipientId) {
      split.push({
        recipient_id: recipientId,
        type: 'percentage',
        amount: Number(manufacturerPercent.toFixed(2)),
        options: {
          charge_processing_fee: false,
          charge_remainder_fee: false,
          liable: true,
        },
      });
    }

    if (PAGARME_MARKETPLACE_RECIPIENT_ID) {
      split.push({
        recipient_id: PAGARME_MARKETPLACE_RECIPIENT_ID,
        type: 'percentage',
        amount: Number(marketplacePercent.toFixed(2)),
        options: {
          charge_processing_fee: true,
          charge_remainder_fee: true,
          liable: false,
        },
      });
    }

    return {
      split,
      subtotal,
      total,
      marketplaceCommission,
    };
  }

  function buildPixPayment(order, split) {
    const amount = toCents(order?.billing?.total || 0);
    return {
      payment_method: 'pix',
      pix: {
        expires_in: 3600,
        additional_information: [
          { name: 'Marketplace', value: 'Ariana Móveis' },
          { name: 'Pedido', value: String(order?.id || order?.orderId || '') },
        ],
      },
      amount,
      split,
    };
  }

  function buildBoletoPayment(order, split) {
    const amount = toCents(order?.billing?.total || 0);
    const customer = buildCustomer(order);
    return {
      payment_method: 'boleto',
      boleto: {
        instructions: 'Não receber após o vencimento.',
        due_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        document_number: String(order?.id || order?.orderId || ''),
        type: 'DM',
      },
      amount,
      split,
      billing_address: customer.address,
    };
  }

  function buildCardPayment(order, split, cardToken) {
    const amount = toCents(order?.billing?.total || 0);
    const installments = Math.max(1, Number(order?.billing?.installments || 1) || 1);
    return {
      payment_method: 'credit_card',
      credit_card: {
        installments,
        statement_descriptor: PAGARME_DEFAULT_SOFT_DESCRIPTOR,
        card_token: cardToken,
      },
      amount,
      split,
    };
  }

  function basicAuthHeader(secretKey) {
    return 'Basic ' + Buffer.from(`${secretKey}:`).toString('base64');
  }

  async function pagarmeRequest({ method, path, body }) {
    if (!PAGARME_SECRET_KEY) {
      throw new Error('PAGARME_SECRET_KEY não configurada');
    }

    const resp = await axios({
      method,
      url: `${PAGARME_BASE}${path}`,
      headers: {
        Authorization: basicAuthHeader(PAGARME_SECRET_KEY),
        'Content-Type': 'application/json',
      },
      timeout: 30000,
      data: body || undefined,
      validateStatus: () => true,
    });

    if (!(resp.status >= 200 && resp.status < 300)) {
      const err = new Error(`Pagar.me retornou ${resp.status}`);
      err.responseStatus = resp.status;
      err.responseData = resp.data;
      throw err;
    }

    return resp.data;
  }

  async function createPagarmeOrder({ order, cardToken, paymentMethod }) {
    const items = buildItems(order);
    if (!items.length) throw new Error('Pedido sem itens para enviar ao Pagar.me');

    const { recipientId } = await resolveRecipientIdForManufacturerOrder(order);
    const splitPayload = buildSplitRules({ order, recipientId });

    const paymentMethodNormalized = String(paymentMethod || order?.billing?.paymentMethod || 'pix').trim().toLowerCase();

    let payment;
    if (paymentMethodNormalized === 'credit_card') {
      if (!cardToken) throw new Error('cardToken é obrigatório para cartão');
      payment = buildCardPayment(order, splitPayload.split, cardToken);
    } else if (paymentMethodNormalized === 'boleto') {
      payment = buildBoletoPayment(order, splitPayload.split);
    } else {
      payment = buildPixPayment(order, splitPayload.split);
    }

    const payload = {
      closed: true,
      code: String(order?.id || order?.orderId || `order_${Date.now()}`),
      customer: buildCustomer(order),
      items,
      payments: [payment],
      metadata: {
        marketplace: 'Ariana Móveis',
        order_id: String(order?.id || order?.orderId || ''),
        seller_id: String(order?.sellerId || order?.seller_id || order?.vendedor_id || ''),
        manufacturer: pickManufacturer(order),
      },
    };

    const response = await pagarmeRequest({
      method: 'POST',
      path: '/orders',
      body: payload,
    });

    return {
      request: payload,
      response,
      splitPayload,
    };
  }

  async function loadOrder(orderId) {
    const id = String(orderId || '').trim();
    if (!id) return null;
    const snap = await db.collection('orders').doc(id).get();
    if (!snap.exists) return null;
    return { id: snap.id, ...(snap.data() || {}) };
  }

  async function savePagarmeOrderResult(orderId, result) {
    const charge = Array.isArray(result?.response?.charges) ? result.response.charges[0] : null;
    const transaction = Array.isArray(charge?.last_transaction) ? charge?.last_transaction[0] : charge?.last_transaction || null;

    const patch = {
      paymentGateway: 'pagarme',
      paymentProvider: 'pagarme',
      payment_provider: 'pagarme',
      pagarme: {
        orderId: result?.response?.id || null,
        code: result?.response?.code || null,
        status: result?.response?.status || null,
        chargeId: charge?.id || null,
        chargeStatus: charge?.status || null,
        paymentMethod: charge?.payment_method || null,
        transactionId: transaction?.id || null,
        qrCodeUrl: transaction?.qr_code_url || null,
        qrCode: transaction?.qr_code || null,
        boletoUrl: transaction?.url || null,
        boletoPdf: transaction?.pdf || null,
        split: result?.splitPayload?.split || [],
        raw: result?.response || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      paymentStatus: result?.response?.status || 'pending',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (typeof mergeOrder === 'function') {
      await mergeOrder(orderId, patch);
    } else {
      await db.collection('orders').doc(String(orderId)).set(patch, { merge: true });
    }
  }

  app.post('/payments/create', async (req, res) => {
    try {
      const body = req.body || {};
      const orderId = String(body.orderId || body.order_id || '').trim();
      if (!orderId) return res.status(400).json({ ok: false, error: 'orderId obrigatório' });

      const order = await loadOrder(orderId);
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' });

      if (isManufacturerPriorityOrder(order)) {
        const paymentMethod = String(body.paymentMethod || order?.billing?.paymentMethod || 'pix').trim().toLowerCase();
        const cardToken = String(body.cardToken || body.card_token || '').trim() || null;

        const result = await createPagarmeOrder({ order, cardToken, paymentMethod });
        await savePagarmeOrderResult(orderId, result);

        if (typeof writeAuditLog === 'function') {
          await writeAuditLog({
            scope: 'payment',
            eventType: 'pagarme_order_created',
            orderId,
            manufacturer: pickManufacturer(order),
            status: 'success',
            request: result.request,
            response: result.response,
            metadata: {
              gateway: 'pagarme',
              paymentMethod,
            },
          });
        }

        return res.json({
          ok: true,
          gateway: 'pagarme',
          orderId,
          pagarme: {
            id: result?.response?.id || null,
            code: result?.response?.code || null,
            status: result?.response?.status || null,
            charges: result?.response?.charges || [],
          },
        });
      }

      return res.status(409).json({
        ok: false,
        gateway: 'mercadopago',
        error: 'Este pedido não é de fabricante prioritário. Mantenha o fluxo atual do Mercado Pago.',
      });
    } catch (e) {
      if (typeof writeAuditLog === 'function') {
        await writeAuditLog({
          scope: 'payment',
          eventType: 'pagarme_order_created',
          orderId: req.body?.orderId || null,
          status: 'error',
          message: e?.message || 'Erro ao criar pedido no Pagar.me',
          request: req.body || null,
          response: {
            status: e?.responseStatus || null,
            data: e?.responseData || null,
          },
          metadata: { gateway: 'pagarme' },
        });
      }

      return res.status(500).json({
        ok: false,
        error: e?.message || 'Erro ao criar pedido no Pagar.me',
        pagarmeStatus: e?.responseStatus || null,
        pagarmeData: e?.responseData || null,
      });
    }
  });

  app.post('/webhooks/pagarme', async (req, res) => {
    try {
      if (PAGARME_WEBHOOK_TOKEN) {
        const headerToken = String(req.get('x-webhook-token') || req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
        if (headerToken !== PAGARME_WEBHOOK_TOKEN) {
          return res.status(401).json({ ok: false, error: 'Webhook Pagar.me não autorizado' });
        }
      }

      const event = req.body || {};
      const data = event?.data || {};
      const orderId = String(
        data?.code ||
        data?.metadata?.order_id ||
        data?.order?.code ||
        data?.order?.metadata?.order_id ||
        ''
      ).trim();

      if (orderId) {
        const patch = {
          paymentGateway: 'pagarme',
          paymentProvider: 'pagarme',
          paymentStatus: data?.status || event?.type || null,
          pagarme: {
            webhookType: event?.type || null,
            status: data?.status || null,
            rawWebhook: event,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        };

        if (typeof mergeOrder === 'function') await mergeOrder(orderId, patch);
        else await db.collection('orders').doc(orderId).set(patch, { merge: true });
      }

      if (typeof writeAuditLog === 'function') {
        await writeAuditLog({
          scope: 'payment_webhook',
          eventType: 'pagarme_webhook_received',
          orderId: orderId || null,
          status: 'success',
          request: event,
          metadata: {
            gateway: 'pagarme',
            type: event?.type || null,
          },
        });
      }

      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || 'Erro no webhook Pagar.me' });
    }
  });

  app.get('/payments/resolve-gateway/:orderId', async (req, res) => {
    try {
      const order = await loadOrder(req.params.orderId);
      if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' });

      const gateway = isManufacturerPriorityOrder(order) ? 'pagarme' : 'mercadopago';
      return res.json({
        ok: true,
        orderId: req.params.orderId,
        gateway,
        reason: gateway === 'pagarme'
          ? 'Pedido de fabricante priorizado para Pagar.me'
          : 'Pedido de seller comum segue no fluxo atual do Mercado Pago',
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || 'Erro ao resolver gateway' });
    }
  });
};
