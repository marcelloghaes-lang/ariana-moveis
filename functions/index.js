/* eslint-disable */
const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");

setGlobalOptions({ region: "southamerica-east1" });

let _app = null;

function buildApp() {
  const admin = require("firebase-admin");
  const express = require("express");
  const cors = require("cors");
  const axios = require("axios");

  if (admin.apps.length === 0) admin.initializeApp();

  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  const db = admin.firestore();

  // ===============================
  // MODO DEV COM CUSTO MÍNIMO
  // ===============================
  const DEV_MODE = String(process.env.DEV_MODE || "true").toLowerCase() !== "false";
  const ENABLE_MP_WEBHOOK = String(process.env.ENABLE_MP_WEBHOOK || "false").toLowerCase() === "true";
  const ENABLE_PAGARME_WEBHOOK = String(process.env.ENABLE_PAGARME_WEBHOOK || "false").toLowerCase() === "true";

  // ===============================
  // HELPERS
  // ===============================
  function envFirst(...keys) {
    for (const k of keys) {
      const v = process.env[k];
      if (v && String(v).trim()) return String(v).trim();
    }
    return "";
  }

  function normalizeDigits(v) {
    return String(v || "").replace(/\D/g, "");
  }

  function toNumberPtBr(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const s = String(v).trim();
    if (!s) return null;
    const normalized = s.replace(/\./g, "").replace(",", ".");
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }

  function amountToCents(v) {
    const n = toNumberPtBr(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 100);
  }

  function amountToFloat(v) {
    const n = toNumberPtBr(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 100) / 100;
  }

  function positiveIntOrNull(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return String(Math.round(n));
  }

  function toGrams(pesoKg) {
    const n = Number(pesoKg);
    if (!Number.isFinite(n) || n <= 0) return null;
    return String(Math.round(n * 1000));
  }

  function parseServices(raw) {
    const s = String(raw || "").trim();
    if (!s) return ["03220", "03298"];
    return s.split(/[;, ]+/).map((x) => x.trim()).filter(Boolean);
  }

  function safeAxiosError(e) {
    return {
      message: e?.message || String(e),
      status: e?.response?.status || null,
      data: e?.response?.data || null,
    };
  }

  function publicBaseUrl(req) {
    const proto = (req.get("x-forwarded-proto") || "https").split(",")[0].trim();
    const host = (req.get("x-forwarded-host") || req.get("host")).split(",")[0].trim();
    return `${proto}://${host}`;
  }

  function splitFullName(fullName) {
    const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return { first: "Cliente", last: "Cliente" };
    if (parts.length === 1) return { first: parts[0], last: "Cliente" };
    return { first: parts[0], last: parts.slice(1).join(" ") };
  }

  function devGuard(allowed) {
    return (req, res, next) => {
      if (!DEV_MODE) return next();
      const path = req.path || req.url || "";
      const ok = allowed.some((p) => path.startsWith(p));
      if (!ok) {
        return res.status(200).json({
          ok: false,
          blocked: true,
          mode: "dev_safe",
          message: "Rota bloqueada em modo desenvolvimento para evitar custo automático.",
        });
      }
      next();
    };
  }

  async function mergeOrder(orderId, patch) {
    if (!orderId) return;
    const id = String(orderId);
    const payload = {
      ...patch,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await Promise.all([
      db.collection("orders").doc(id).set(payload, { merge: true }),
      db.collection("pedidos").doc(id).set(payload, { merge: true }),
    ]);
  }

  function mpHeaders(token, idemSeed) {
    return {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Idempotency-Key": `idem-${Buffer.from(String(idemSeed)).toString("base64").slice(0, 40)}`,
      },
      timeout: 30000,
    };
  }

  function pagarmeHeaders(secretKey) {
    const basic = Buffer.from(`${secretKey}:`).toString("base64");
    return {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  function buildCustomerFromBody(body) {
    const name = String(body?.payerName || body?.name || "Cliente").trim();
    const email = String(body?.payerEmail || body?.email || "").trim().toLowerCase();
    const cpf = normalizeDigits(body?.cpf || body?.document || "");
    const phone = normalizeDigits(body?.phone || body?.telefone || "");
    const zip = normalizeDigits(body?.address?.zip_code || body?.zip_code || "");
    const street = String(body?.address?.street || body?.address?.street_name || "").trim();
    const number = String(body?.address?.number || body?.address?.street_number || "").trim();
    const neighborhood = String(body?.address?.neighborhood || "").trim();
    const city = String(body?.address?.city || "").trim();
    const state = String(body?.address?.state || body?.address?.federal_unit || "").trim().toUpperCase();

    const mobilePhone =
      phone.length >= 10
        ? {
            country_code: "55",
            area_code: phone.slice(0, 2),
            number: phone.slice(2),
          }
        : undefined;

    const customer = {
      name,
      email,
      type: "individual",
      documents: cpf
        ? [{ type: "cpf", number: cpf }]
        : undefined,
      phones: mobilePhone ? { mobile_phone: mobilePhone } : undefined,
      address:
        zip && street && number && neighborhood && city && state
          ? {
              line_1: `${number}, ${street}, ${neighborhood}`,
              zip_code: zip,
              city,
              state,
              country: "BR",
            }
          : undefined,
    };

    return customer;
  }

  function normalizePagarmeStatus(charge) {
    const status =
      charge?.last_transaction?.status ||
      charge?.status ||
      null;

    if (status === "paid" || status === "captured") return "paid";
    if (status === "processing" || status === "pending") return "pending_payment";
    if (status === "failed" || status === "refused" || status === "not_authorized") return "payment_failed";
    if (status === "canceled" || status === "voided") return "cancelled";
    return "pending_payment";
  }

  // Remove /api do path quando estiver atrás do Hosting rewrite
  app.use((req, _res, next) => {
    if (req.url.startsWith("/api")) req.url = req.url.replace("/api", "");
    next();
  });

  // ===============================
  // HEALTH
  // ===============================
  app.get("/", (_req, res) => {
    res.json({
      ok: true,
      service: "Ariana Moveis API",
      mode: DEV_MODE ? "dev_safe" : "production",
      gateways: {
        mercadopago: true,
        pagarme: true,
        correios: true,
        cielo: false,
      },
    });
  });

  // ===============================
  // MERCADO PAGO
  // ===============================
  const MP_BASE = "https://api.mercadopago.com";

  app.get("/payments/mp/public_key", devGuard(["/payments/mp/public_key"]), async (_req, res) => {
    try {
      const publicKey = envFirst("MP_PUBLIC_KEY", "MERCADOPAGO_PUBLIC_KEY");
      if (!publicKey) {
        return res.status(400).json({ ok: false, error: "MP_PUBLIC_KEY não configurada" });
      }
      return res.json({ ok: true, publicKey });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "Erro ao obter MP public key", details: String(e?.message || e) });
    }
  });

  app.post("/payments/mp/pix", devGuard(["/payments/mp/pix"]), async (req, res) => {
    try {
      const token = envFirst("MP_ACCESS_TOKEN");
      if (!token) return res.status(400).json({ ok: false, error: "MP_ACCESS_TOKEN não configurado" });

      const orderId = String(req.body?.orderId || "").trim();
      const amount = amountToFloat(req.body?.amount);
      const payerEmail = String(req.body?.payerEmail || req.body?.email || "").trim();

      if (!orderId) return res.status(400).json({ ok: false, error: "orderId é obrigatório" });
      if (!amount) return res.status(400).json({ ok: false, error: "amount inválido" });
      if (!payerEmail) return res.status(400).json({ ok: false, error: "email é obrigatório" });

      const webhookUrl = `${publicBaseUrl(req)}/webhooks/mercadopago`;

      const mpResp = await axios.post(
        `${MP_BASE}/v1/payments`,
        {
          transaction_amount: amount,
          description: `Ariana Moveis - Pedido ${orderId}`,
          payment_method_id: "pix",
          payer: { email: payerEmail },
          external_reference: orderId,
          notification_url: webhookUrl,
        },
        mpHeaders(token, `${orderId}-mp-pix-${amount}`)
      );

      const p = mpResp.data || {};

      await mergeOrder(orderId, {
        status: "pending_payment",
        payment: {
          provider: "mercadopago",
          method: "pix",
          paymentId: p.id,
          status: p.status,
          statusDetail: p.status_detail || null,
          liveMode: !!p.live_mode,
        },
      });

      return res.json({
        ok: true,
        provider: "mercadopago",
        method: "pix",
        paymentId: p.id,
        status: p.status,
        qrCode: p?.point_of_interaction?.transaction_data?.qr_code || null,
        qrCodeBase64: p?.point_of_interaction?.transaction_data?.qr_code_base64 || null,
        ticketUrl: p?.point_of_interaction?.transaction_data?.ticket_url || null,
      });
    } catch (e) {
      const err = safeAxiosError(e);
      return res.status(err.status || 500).json({ ok: false, error: "Erro MP PIX", details: err.data || err.message });
    }
  });

  app.post("/payments/mp/boleto", devGuard(["/payments/mp/boleto"]), async (req, res) => {
    try {
      const token = envFirst("MP_ACCESS_TOKEN");
      if (!token) return res.status(400).json({ ok: false, error: "MP_ACCESS_TOKEN não configurado" });

      const orderId = String(req.body?.orderId || "").trim();
      const amount = amountToFloat(req.body?.amount);
      const payerEmail = String(req.body?.payerEmail || req.body?.email || "").trim();
      const payerName = String(req.body?.payerName || req.body?.name || "Cliente").trim();
      const cpf = normalizeDigits(req.body?.cpf || "");

      if (!orderId) return res.status(400).json({ ok: false, error: "orderId é obrigatório" });
      if (!amount) return res.status(400).json({ ok: false, error: "amount inválido" });
      if (!payerEmail) return res.status(400).json({ ok: false, error: "email é obrigatório" });
      if (cpf.length !== 11) return res.status(400).json({ ok: false, error: "cpf inválido" });

      const name = splitFullName(payerName);
      const webhookUrl = `${publicBaseUrl(req)}/webhooks/mercadopago`;

      const mpResp = await axios.post(
        `${MP_BASE}/v1/payments`,
        {
          transaction_amount: amount,
          description: `Ariana Moveis - Pedido ${orderId} (Boleto)`,
          payment_method_id: "bolbradesco",
          payer: {
            email: payerEmail,
            first_name: name.first,
            last_name: name.last,
            identification: { type: "CPF", number: cpf },
          },
          external_reference: orderId,
          notification_url: webhookUrl,
        },
        mpHeaders(token, `${orderId}-mp-boleto-${amount}-${cpf}`)
      );

      const p = mpResp.data || {};

      await mergeOrder(orderId, {
        status: "pending_payment",
        payment: {
          provider: "mercadopago",
          method: "boleto",
          paymentId: p.id,
          status: p.status,
          statusDetail: p.status_detail || null,
          liveMode: !!p.live_mode,
        },
      });

      return res.json({
        ok: true,
        provider: "mercadopago",
        method: "boleto",
        paymentId: p.id,
        status: p.status,
        ticketUrl: p?.transaction_details?.external_resource_url || null,
        digitableLine: p?.barcode?.content || p?.barcode || null,
      });
    } catch (e) {
      const err = safeAxiosError(e);
      return res.status(err.status || 500).json({ ok: false, error: "Erro MP BOLETO", details: err.data || err.message });
    }
  });

  app.post("/payments/mp/credit", devGuard(["/payments/mp/credit"]), async (req, res) => {
    try {
      const token = envFirst("MP_ACCESS_TOKEN");
      if (!token) return res.status(400).json({ ok: false, error: "MP_ACCESS_TOKEN não configurado" });

      const body = req.body || {};
      const orderId = String(body.orderId || "").trim();
      const amount = amountToFloat(body.amount);
      const payerEmail = String(body.payerEmail || body.email || "").trim();
      const payerName = String(body.payerName || body.name || "Cliente").trim();
      const cpf = normalizeDigits(body.cpf || "");
      const cardToken = String(body.token || "").trim();
      const paymentMethodId = String(body.payment_method_id || "").trim();
      const issuerId = body.issuer_id || undefined;
      const installments = Number(body.installments || 1);

      if (!orderId) return res.status(400).json({ ok: false, error: "orderId é obrigatório" });
      if (!amount) return res.status(400).json({ ok: false, error: "amount inválido" });
      if (!payerEmail) return res.status(400).json({ ok: false, error: "email é obrigatório" });
      if (cpf.length !== 11) return res.status(400).json({ ok: false, error: "cpf inválido" });
      if (!cardToken) return res.status(400).json({ ok: false, error: "token do cartão é obrigatório" });
      if (!paymentMethodId) return res.status(400).json({ ok: false, error: "payment_method_id é obrigatório" });

      const name = splitFullName(payerName);
      const webhookUrl = `${publicBaseUrl(req)}/webhooks/mercadopago`;

      const mpResp = await axios.post(
        `${MP_BASE}/v1/payments`,
        {
          transaction_amount: amount,
          token: cardToken,
          installments,
          payment_method_id: paymentMethodId,
          issuer_id: issuerId,
          description: `Ariana Moveis - Pedido ${orderId} (Cartão)`,
          payer: {
            email: payerEmail,
            first_name: name.first,
            last_name: name.last,
            identification: { type: "CPF", number: cpf },
          },
          external_reference: orderId,
          notification_url: webhookUrl,
        },
        mpHeaders(token, `${orderId}-mp-credit-${amount}-${cpf}`)
      );

      const p = mpResp.data || {};

      await mergeOrder(orderId, {
        status: "pending_payment",
        payment: {
          provider: "mercadopago",
          method: "credit_card",
          paymentId: p.id,
          status: p.status,
          statusDetail: p.status_detail || null,
          liveMode: !!p.live_mode,
        },
      });

      return res.json({
        ok: true,
        provider: "mercadopago",
        method: "credit_card",
        paymentId: p.id,
        status: p.status,
        statusDetail: p.status_detail || null,
      });
    } catch (e) {
      const err = safeAxiosError(e);
      return res.status(err.status || 500).json({ ok: false, error: "Erro MP CREDIT", details: err.data || err.message });
    }
  });

  app.post("/webhooks/mercadopago", async (req, res) => {
    if (!ENABLE_MP_WEBHOOK) {
      return res.status(200).json({ ok: true, skipped: true, reason: "webhook desativado em dev" });
    }

    try {
      const paymentId = req.body?.data?.id || req.query?.id || req.body?.id || null;
      if (!paymentId) return res.sendStatus(200);

      const token = envFirst("MP_ACCESS_TOKEN");
      if (!token) return res.sendStatus(200);

      const r = await axios.get(`${MP_BASE}/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 20000,
      });

      const p = r.data || {};
      const orderId = p?.external_reference || null;
      if (!orderId) return res.sendStatus(200);

      const mpStatus = p.status;
      const orderStatus =
        mpStatus === "approved" ? "paid" :
        mpStatus === "pending" ? "pending_payment" :
        mpStatus === "in_process" ? "pending_payment" :
        mpStatus === "rejected" ? "payment_failed" :
        mpStatus === "cancelled" ? "cancelled" :
        mpStatus === "refunded" ? "refunded" :
        "pending_payment";

      await mergeOrder(orderId, {
        status: orderStatus,
        payment: {
          provider: "mercadopago",
          paymentId: p.id,
          status: p.status,
          statusDetail: p.status_detail || null,
          liveMode: !!p.live_mode,
        },
      });

      return res.sendStatus(200);
    } catch (_e) {
      return res.sendStatus(200);
    }
  });

  // ===============================
  // PAGAR.ME
  // ===============================
  const PAGARME_BASE = "https://api.pagar.me/core/v5";

  app.get("/payments/pagarme/public_key", devGuard(["/payments/pagarme/public_key"]), async (_req, res) => {
    const publicKey = envFirst("PAGARME_PUBLIC_KEY");
    if (!publicKey) {
      return res.status(400).json({ ok: false, error: "PAGARME_PUBLIC_KEY não configurada" });
    }
    return res.json({ ok: true, publicKey });
  });

  app.post("/payments/pagarme/pix", devGuard(["/payments/pagarme/pix"]), async (req, res) => {
    try {
      const secretKey = envFirst("PAGARME_SECRET_KEY");
      if (!secretKey) return res.status(400).json({ ok: false, error: "PAGARME_SECRET_KEY não configurada" });

      const body = req.body || {};
      const orderId = String(body.orderId || "").trim();
      const amountCents = amountToCents(body.amount);
      if (!orderId) return res.status(400).json({ ok: false, error: "orderId é obrigatório" });
      if (!amountCents) return res.status(400).json({ ok: false, error: "amount inválido" });

      const customer = buildCustomerFromBody(body);
      if (!customer.email) return res.status(400).json({ ok: false, error: "email é obrigatório" });

      const payload = {
        code: orderId,
        items: [
          {
            code: orderId,
            amount: amountCents,
            description: body.description || `Pedido ${orderId}`,
            quantity: 1,
          },
        ],
        customer,
        payments: [
          {
            payment_method: "pix",
            pix: {
              expires_in: Number(body.pixExpiresIn || 3600),
            },
          },
        ],
        metadata: {
          order_id: orderId,
          source: "ariana-moveis",
        },
      };

      const r = await axios.post(
        `${PAGARME_BASE}/orders`,
        payload,
        {
          headers: pagarmeHeaders(secretKey),
          timeout: 30000,
        }
      );

      const order = r.data || {};
      const charge = order?.charges?.[0] || {};
      const tx = charge?.last_transaction || {};

      await mergeOrder(orderId, {
        status: normalizePagarmeStatus(charge),
        payment: {
          provider: "pagarme",
          method: "pix",
          orderIdGateway: order?.id || null,
          chargeId: charge?.id || null,
          status: tx?.status || charge?.status || null,
        },
      });

      return res.json({
        ok: true,
        provider: "pagarme",
        method: "pix",
        orderIdGateway: order?.id || null,
        chargeId: charge?.id || null,
        status: tx?.status || charge?.status || null,
        qrCode: tx?.qr_code || null,
        qrCodeUrl: tx?.qr_code_url || null,
        expiresAt: tx?.expires_at || null,
        raw: order,
      });
    } catch (e) {
      const err = safeAxiosError(e);
      return res.status(err.status || 500).json({ ok: false, error: "Erro PAGARME PIX", details: err.data || err.message });
    }
  });

  app.post("/payments/pagarme/boleto", devGuard(["/payments/pagarme/boleto"]), async (req, res) => {
    try {
      const secretKey = envFirst("PAGARME_SECRET_KEY");
      if (!secretKey) return res.status(400).json({ ok: false, error: "PAGARME_SECRET_KEY não configurada" });

      const body = req.body || {};
      const orderId = String(body.orderId || "").trim();
      const amountCents = amountToCents(body.amount);
      const customer = buildCustomerFromBody(body);

      if (!orderId) return res.status(400).json({ ok: false, error: "orderId é obrigatório" });
      if (!amountCents) return res.status(400).json({ ok: false, error: "amount inválido" });
      if (!customer.email) return res.status(400).json({ ok: false, error: "email é obrigatório" });

      const payload = {
        code: orderId,
        items: [
          {
            code: orderId,
            amount: amountCents,
            description: body.description || `Pedido ${orderId}`,
            quantity: 1,
          },
        ],
        customer,
        payments: [
          {
            payment_method: "boleto",
            boleto: {
              instructions: body.instructions || "Pagar até o vencimento.",
              due_at: body.due_at || undefined,
              document_number: body.document_number || orderId,
              type: body.boleto_type || "DM",
            },
          },
        ],
        metadata: {
          order_id: orderId,
          source: "ariana-moveis",
        },
      };

      const r = await axios.post(
        `${PAGARME_BASE}/orders`,
        payload,
        {
          headers: pagarmeHeaders(secretKey),
          timeout: 30000,
        }
      );

      const order = r.data || {};
      const charge = order?.charges?.[0] || {};
      const tx = charge?.last_transaction || {};

      await mergeOrder(orderId, {
        status: normalizePagarmeStatus(charge),
        payment: {
          provider: "pagarme",
          method: "boleto",
          orderIdGateway: order?.id || null,
          chargeId: charge?.id || null,
          status: tx?.status || charge?.status || null,
        },
      });

      return res.json({
        ok: true,
        provider: "pagarme",
        method: "boleto",
        orderIdGateway: order?.id || null,
        chargeId: charge?.id || null,
        status: tx?.status || charge?.status || null,
        pdf: tx?.pdf || null,
        line: tx?.line || null,
        barcode: tx?.barcode || null,
        dueAt: tx?.due_at || null,
        raw: order,
      });
    } catch (e) {
      const err = safeAxiosError(e);
      return res.status(err.status || 500).json({ ok: false, error: "Erro PAGARME BOLETO", details: err.data || err.message });
    }
  });

  app.post("/payments/pagarme/credit", devGuard(["/payments/pagarme/credit"]), async (req, res) => {
    try {
      const secretKey = envFirst("PAGARME_SECRET_KEY");
      if (!secretKey) return res.status(400).json({ ok: false, error: "PAGARME_SECRET_KEY não configurada" });

      const body = req.body || {};
      const orderId = String(body.orderId || "").trim();
      const amountCents = amountToCents(body.amount);
      const customer = buildCustomerFromBody(body);
      const installments = Number(body.installments || 1);
      const statementDescriptor = String(body.statement_descriptor || "ARIANA MOVEIS").slice(0, 13);

      const cardToken = String(body.card_token || "").trim();
      const cardId = String(body.card_id || "").trim();

      if (!orderId) return res.status(400).json({ ok: false, error: "orderId é obrigatório" });
      if (!amountCents) return res.status(400).json({ ok: false, error: "amount inválido" });
      if (!customer.email) return res.status(400).json({ ok: false, error: "email é obrigatório" });
      if (!cardToken && !cardId) {
        return res.status(400).json({ ok: false, error: "Informe card_token ou card_id" });
      }

      const creditCard = {
        installments,
        statement_descriptor: statementDescriptor,
        operation_type: "auth_and_capture",
      };

      if (cardToken) creditCard.card_token = cardToken;
      if (cardId) creditCard.card_id = cardId;

      const payload = {
        code: orderId,
        items: [
          {
            code: orderId,
            amount: amountCents,
            description: body.description || `Pedido ${orderId}`,
            quantity: 1,
          },
        ],
        customer,
        payments: [
          {
            payment_method: "credit_card",
            credit_card: creditCard,
          },
        ],
        metadata: {
          order_id: orderId,
          source: "ariana-moveis",
        },
      };

      const r = await axios.post(
        `${PAGARME_BASE}/orders`,
        payload,
        {
          headers: pagarmeHeaders(secretKey),
          timeout: 30000,
        }
      );

      const order = r.data || {};
      const charge = order?.charges?.[0] || {};
      const tx = charge?.last_transaction || {};

      await mergeOrder(orderId, {
        status: normalizePagarmeStatus(charge),
        payment: {
          provider: "pagarme",
          method: "credit_card",
          orderIdGateway: order?.id || null,
          chargeId: charge?.id || null,
          status: tx?.status || charge?.status || null,
        },
      });

      return res.json({
        ok: true,
        provider: "pagarme",
        method: "credit_card",
        orderIdGateway: order?.id || null,
        chargeId: charge?.id || null,
        status: tx?.status || charge?.status || null,
        acquirerMessage: tx?.acquirer_message || null,
        acquirerReturnCode: tx?.acquirer_return_code || null,
        raw: order,
      });
    } catch (e) {
      const err = safeAxiosError(e);
      return res.status(err.status || 500).json({ ok: false, error: "Erro PAGARME CREDIT", details: err.data || err.message });
    }
  });

  app.get("/payments/pagarme/status/:orderIdGateway", devGuard(["/payments/pagarme/status"]), async (req, res) => {
    try {
      const secretKey = envFirst("PAGARME_SECRET_KEY");
      if (!secretKey) return res.status(400).json({ ok: false, error: "PAGARME_SECRET_KEY não configurada" });

      const orderIdGateway = String(req.params.orderIdGateway || "").trim();
      if (!orderIdGateway) return res.status(400).json({ ok: false, error: "orderIdGateway é obrigatório" });

      const r = await axios.get(
        `${PAGARME_BASE}/orders/${orderIdGateway}`,
        {
          headers: pagarmeHeaders(secretKey),
          timeout: 20000,
        }
      );

      return res.json({ ok: true, raw: r.data || null });
    } catch (e) {
      const err = safeAxiosError(e);
      return res.status(err.status || 500).json({ ok: false, error: "Erro PAGARME STATUS", details: err.data || err.message });
    }
  });

  app.post("/webhooks/pagarme", async (req, res) => {
    if (!ENABLE_PAGARME_WEBHOOK) {
      return res.status(200).json({ ok: true, skipped: true, reason: "webhook desativado em dev" });
    }

    try {
      const event = req.body || {};
      const data = event?.data || {};
      const orderId =
        data?.metadata?.order_id ||
        data?.order?.metadata?.order_id ||
        data?.order?.code ||
        null;

      if (!orderId) return res.sendStatus(200);

      const charge = data?.charge || data?.order?.charges?.[0] || {};
      const tx = charge?.last_transaction || {};

      await mergeOrder(orderId, {
        status: normalizePagarmeStatus(charge),
        payment: {
          provider: "pagarme",
          chargeId: charge?.id || null,
          status: tx?.status || charge?.status || null,
        },
      });

      return res.sendStatus(200);
    } catch (_e) {
      return res.sendStatus(200);
    }
  });

  // ===============================
  // CORREIOS
  // ===============================
  let tokenCache = { token: null, exp: 0 };

  function correiosCfg() {
    const user = envFirst("CORREIOS_USER");
    const pass = envFirst("CORREIOS_PASS");
    const cartao = envFirst("CORREIOS_CARTAO");
    const contrato = envFirst("CORREIOS_CONTRATO");
    const dr = envFirst("CORREIOS_DR") || "0";
    const originCep = envFirst("LOJA_ORIGEM_CEP");
    const services = parseServices(envFirst("CORREIOS_SERVICOS"));

    return {
      user,
      pass,
      cartao,
      contrato,
      dr,
      originCep,
      services,
      tokenUrl: "https://api.correios.com.br/token/v1/autentica/cartaopostagem",
      precoUrl: "https://api.correios.com.br/preco/v1/nacional",
    };
  }

  async function getCorreiosToken() {
    const cfg = correiosCfg();
    const now = Date.now();

    if (tokenCache.token && tokenCache.exp > now) return tokenCache.token;

    const user = String(cfg.user || "").trim();
    const pass = String(cfg.pass || "").trim();

    if (!user || !pass) throw new Error("Correios: credenciais ausentes");
    if (!cfg.cartao) throw new Error("Correios: cartão ausente");

    const auth = Buffer.from(`${user}:${pass}`).toString("base64");

    const body = {
      numero: cfg.cartao,
      contrato: cfg.contrato || undefined,
      dr: cfg.dr ? Number(cfg.dr) : undefined,
    };

    const r = await axios.post(cfg.tokenUrl, body, {
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: 20000,
    });

    const expiresIn = Number(r.data?.expires_in || 3000);
    const token = r.data?.token;
    if (!token) throw new Error("Correios: token não retornou");

    tokenCache.token = token;
    tokenCache.exp = now + Math.max(60, expiresIn - 60) * 1000;
    return tokenCache.token;
  }

  const SERVICE_NAMES = {
    "03298": "PAC",
    "03220": "SEDEX",
  };

  app.post("/shipping/correios/quote", devGuard(["/shipping/correios/quote"]), async (req, res) => {
    try {
      const cfg = correiosCfg();
      const token = await getCorreiosToken();

      const cepOrigem = normalizeDigits(cfg.originCep);
      const cepDestino = normalizeDigits(req.body?.cepDestino);

      if (cepOrigem.length !== 8) return res.status(400).json({ ok: false, error: "LOJA_ORIGEM_CEP inválido" });
      if (cepDestino.length !== 8) return res.status(400).json({ ok: false, error: "cepDestino inválido" });

      const psObjeto = toGrams(req.body?.pesoKg);
      if (!psObjeto) return res.status(400).json({ ok: false, error: "pesoKg inválido" });

      let comprimento = positiveIntOrNull(req.body?.comprimento) || "11";
      let largura = positiveIntOrNull(req.body?.largura) || "11";
      let altura = positiveIntOrNull(req.body?.altura) || "2";

      const idLote = String(Date.now());

      const parametrosProduto = cfg.services.map((coProduto, idx) => ({
        coProduto: String(coProduto),
        nuRequisicao: String(idx + 1).padStart(4, "0"),
        cepOrigem,
        cepDestino,
        psObjeto,
        tpObjeto: "2",
        comprimento,
        largura,
        altura,
        nuContrato: cfg.contrato || undefined,
        nuDR: Number(cfg.dr) || undefined,
      }));

      const r = await axios.post(
        cfg.precoUrl,
        { idLote, parametrosProduto },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          timeout: 20000,
        }
      );

      const rawList =
        Array.isArray(r.data) ? r.data :
        Array.isArray(r.data?.itens) ? r.data.itens :
        Array.isArray(r.data?.resultado) ? r.data.resultado :
        [];

      const quotes = [];
      const errors = [];

      for (const item of rawList) {
        const coProduto = String(item?.coProduto || "");
        const txErro = item?.txErro ? String(item.txErro) : "";

        if (txErro) {
          errors.push({
            service: coProduto,
            name: SERVICE_NAMES[coProduto] || coProduto,
            message: txErro,
          });
          continue;
        }

        const price =
          toNumberPtBr(item?.pcFinal) ??
          toNumberPtBr(item?.pcBaseGeral) ??
          toNumberPtBr(item?.pcReferencia) ??
          null;

        const deadlineDays =
          Number(item?.prazoEntrega) ||
          Number(item?.nuPrazoEntrega) ||
          null;

        quotes.push({
          service: coProduto,
          name: SERVICE_NAMES[coProduto] || coProduto,
          price,
          deadlineDays,
        });
      }

      quotes.sort((a, b) => (a.price ?? 999999) - (b.price ?? 999999));

      return res.json({
        ok: true,
        quotes,
        errors,
        meta: {
          cepOrigem,
          cepDestino,
          servicesRequested: cfg.services,
        },
      });
    } catch (e) {
      const err = safeAxiosError(e);
      return res.status(err.status || 500).json({ ok: false, error: "Erro Correios", details: err.data || err.message });
    }
  });

  return app;
}

function getApp() {
  if (_app) return _app;
  _app = buildApp();
  return _app;
}

exports.api = onRequest(
  {
    region: "southamerica-east1", // Garante que rode em São Paulo (mais rápido e barato para você)
    cors: true,
    timeoutSeconds: 15,           // ECONOMIA: Se a API travar, ela desliga em 15s em vez de 60s
    memory: "128MiB",             // ECONOMIA: Corta o custo de reserva de RAM pela metade
    secrets: [
      "MP_ACCESS_TOKEN",
      "MP_PUBLIC_KEY",
      "PAGARME_SECRET_KEY",
      "PAGARME_PUBLIC_KEY",
      "CORREIOS_USER",
      "CORREIOS_PASS",
      "CORREIOS_CARTAO",
      "CORREIOS_CONTRATO",
      "CORREIOS_DR",
      "CORREIOS_SERVICOS",
      "LOJA_ORIGEM_CEP",
    ],
  },
  (req, res) => getApp()(req, res)
);