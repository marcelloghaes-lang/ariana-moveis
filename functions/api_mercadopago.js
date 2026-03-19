/* eslint-disable */
const axios = require("axios");
const crypto = require("crypto");

function env(name, required = true, fallback = undefined) {
  const v = process.env[name] ?? fallback;
  if (required && (v === undefined || v === null || String(v).trim() === "")) {
    throw new Error(`ENV faltando: ${name}`);
  }
  return v;
}

const MP_BASE = "https://api.mercadopago.com";
const ACCESS_TOKEN = env("MP_ACCESS_TOKEN"); // Access Token (credencial do MP)
const WEBHOOK_URL = env("MP_WEBHOOK_URL");   // URL pública https://.../webhooks/mercadopago

function toNumber(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error("amount inválido");
  return n;
}

function onlyDigits(v) {
  return String(v || "").replace(/\D/g, "");
}

function buildPayer({ email, name, cpf, payerId }) {
  if (!email) throw new Error("email é obrigatório");
  const cpfDigits = onlyDigits(cpf);
  if (cpfDigits.length !== 11) throw new Error("cpf inválido (precisa ter 11 dígitos)");

  const payer = {
    email,
    first_name: name || "Cliente",
    identification: { type: "CPF", number: cpfDigits },
  };

  // Opcional: ID do test user
  if (payerId) payer.id = Number(payerId);
  return payer;
}

// Idempotency: estável por pedido por método (evita cobrança duplicada em retry)
function makeIdempotencyKey(seed) {
  return crypto.createHash("sha256").update(String(seed)).digest("hex");
}

async function mpCreatePayment(body, idempotencyKey) {
  const r = await axios.post(`${MP_BASE}/v1/payments`, body, {
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": idempotencyKey || makeIdempotencyKey(body.external_reference || "no-order"),
    },
    timeout: 20000,
  });
  return r.data;
}

async function mpGetPayment(id) {
  const r = await axios.get(`${MP_BASE}/v1/payments/${id}`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    timeout: 20000,
  });
  return r.data;
}

module.exports = (app, admin) => {
  const db = admin ? admin.firestore() : null;

  // ===== PIX =====
  app.post("/mp/pix", async (req, res) => {
    try {
      const { orderId, amount, email, name, cpf } = req.body || {};
      if (!orderId) throw new Error("orderId é obrigatório");

      const body = {
        transaction_amount: toNumber(amount),
        description: `Pedido ${orderId}`,
        payment_method_id: "pix",
        payer: buildPayer({ email, name, cpf }),
        notification_url: WEBHOOK_URL,
        external_reference: String(orderId),
      };

      const data = await mpCreatePayment(body, makeIdempotencyKey(`pix:${orderId}`));

      return res.json({
        ok: true,
        paymentId: data?.id,
        status: data?.status,
        qr_code: data?.point_of_interaction?.transaction_data?.qr_code || null,
        qr_code_base64: data?.point_of_interaction?.transaction_data?.qr_code_base64 || null,
        raw: data,
      });
    } catch (e) {
      console.error("[MP PIX ERROR]", e?.response?.data || e);
      return res.status(e?.response?.status || 500).json({
        ok: false,
        stage: "mp/pix",
        error: e?.message || String(e),
        details: e?.response?.data || null,
      });
    }
  });

  // ===== BOLETO =====
  app.post("/mp/boleto", async (req, res) => {
    try {
      const { orderId, amount, email, name, cpf, payerId } = req.body || {};
      if (!orderId) throw new Error("orderId é obrigatório");
      if (!email) throw new Error("email é obrigatório");
      if (!cpf) throw new Error("cpf é obrigatório");

      const body = {
        transaction_amount: toNumber(amount),
        description: `Pedido ${orderId}`,
        payment_method_id: "bolbradesco",
        payer: buildPayer({ email, name, cpf, payerId }),
        notification_url: WEBHOOK_URL,
        external_reference: String(orderId),
      };

      const data = await mpCreatePayment(body, makeIdempotencyKey(`boleto:${orderId}`));
      const boletoUrl = data?.transaction_details?.external_resource_url || null;

      return res.json({
        ok: true,
        paymentId: data?.id,
        status: data?.status,
        boleto_url: boletoUrl,
      });
    } catch (e) {
      console.error("[MP BOLETO ERROR]", {
        msg: e?.message || String(e),
        status: e?.response?.status,
        data: e?.response?.data,
        stack: e?.stack,
      });

      return res.status(e?.response?.status || 500).json({
        ok: false,
        stage: "mp/boleto",
        error: e?.message || String(e),
        details: e?.response?.data || null,
      });
    }
  });

  // ===== CARTÃO DE CRÉDITO =====
  app.post("/mp/credit", async (req, res) => {
    try {
      const { token, payment_method_id, installments, transaction_amount, orderId, email, cpf, name, issuer_id } =
        req.body || {};

      if (!orderId) throw new Error("orderId é obrigatório");
      if (!token) throw new Error("token é obrigatório");
      if (!payment_method_id) throw new Error("payment_method_id é obrigatório");

      const body = {
        transaction_amount: toNumber(transaction_amount),
        token,
        description: `Pedido ${orderId}`,
        installments: Number(installments || 1),
        payment_method_id,
        ...(issuer_id ? { issuer_id: Number(issuer_id) } : {}),
        payer: buildPayer({ email, name, cpf }),
        notification_url: WEBHOOK_URL,
        external_reference: String(orderId),
      };

      const data = await mpCreatePayment(body, makeIdempotencyKey(`card:${orderId}`));
      return res.json({ ok: true, paymentId: data?.id, status: data?.status, raw: data });
    } catch (e) {
      console.error("[MP CREDIT ERROR]", e?.response?.data || e);
      return res.status(e?.response?.status || 500).json({
        ok: false,
        stage: "mp/credit",
        error: e?.message || String(e),
        details: e?.response?.data || null,
      });
    }
  });

  // ===== WEBHOOK =====
  app.post("/webhooks/mercadopago", async (req, res) => {
    try {
      const paymentId = req.body?.data?.id || req.body?.id || req.query?.id || null;
      if (!paymentId) return res.sendStatus(200);

      const payment = await mpGetPayment(paymentId);
      const status = payment?.status;
      const orderId = payment?.external_reference;

      console.log("[MP WEBHOOK RECEBIDO]", { paymentId, status, orderId });

      if (orderId && db) {
        const statusFinal = status === "approved" ? "paid" : status;
        await Promise.all([
          db.collection("orders").doc(String(orderId)).set({ status: statusFinal, mp_id: paymentId }, { merge: true }),
          db.collection("pedidos").doc(String(orderId)).set({ status: statusFinal }, { merge: true }),
        ]);
        console.log(`[FIRESTORE] Pedido ${orderId} atualizado para ${statusFinal}`);
      }

      return res.sendStatus(200);
    } catch (e) {
      console.error("[MP WEBHOOK ERROR]", e?.message || e);
      return res.sendStatus(200);
    }
  });
};
