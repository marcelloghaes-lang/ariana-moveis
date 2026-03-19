/* eslint-disable */
const axios = require("axios");

function env(name, required = false, fallback = undefined) {
  const v = process.env[name] ?? fallback;
  const s = v == null ? "" : String(v);
  if (required && s.trim() === "") throw new Error(`ENV faltando: ${name}`);
  return s;
}

function tail3(s) {
  const t = String(s || "");
  if (t.length <= 3) return t;
  return t.slice(-3);
}

function maskId(id) {
  const s = String(id || "").trim();
  if (!s) return "(vazio)";
  if (s.length <= 6) return "***" + s;
  return s.slice(0, 3) + "***" + s.slice(-3);
}

function cieloBaseUrl() {
  // ✅ agora NÃO quebra se CIELO_ENV não existir
  const e = String(env("CIELO_ENV", false, "production")).toLowerCase().trim();
  if (e === "sandbox" || e === "test" || e === "teste") {
    return "https://apisandbox.cieloecommerce.cielo.com.br";
  }
  return "https://api.cieloecommerce.cielo.com.br";
}

function onlyDigits(v) {
  return String(v || "").replace(/\D/g, "");
}

function moneyToCents(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw new Error("amount inválido");
  return Math.round(n * 100);
}

function normalizeExp(exp) {
  const s = String(exp || "").trim();
  if (!s) throw new Error("card.expiration é obrigatório");
  const parts = s.split("/");
  if (parts.length !== 2) throw new Error("expiration inválido (use MM/AAAA)");
  let mm = parts[0].padStart(2, "0");
  let yy = parts[1];
  if (yy.length === 2) yy = `20${yy}`;
  if (yy.length !== 4) throw new Error("expiration inválido (use MM/AAAA)");
  return `${mm}/${yy}`;
}

async function cieloRequest(method, path, body) {
  // ✅ TRIM para eliminar espaço / quebra invisível
  const merchantId = String(env("CIELO_MERCHANT_ID", true)).trim();
  const merchantKey = String(env("CIELO_MERCHANT_KEY", true)).trim();

  const base = cieloBaseUrl();
  const url = `${base}${path}`;

  const r = await axios({
    method,
    url,
    data: body,
    headers: {
      MerchantId: merchantId,
      MerchantKey: merchantKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: 20000,
    validateStatus: () => true,
  });

  // Cielo geralmente retorna 4xx com JSON explicando
  if (r.status < 200 || r.status >= 300) {
    const err = new Error(`Cielo HTTP ${r.status}`);
    err.status = r.status;
    err.details = r.data || null;
    throw err;
  }

  return r.data;
}

module.exports = (app) => {
  // ✅ DEBUG (não expõe a chave)
  // GET /debug/cielo
  app.get("/debug/cielo", (_req, res) => {
    const merchantId = String(process.env.CIELO_MERCHANT_ID || "").trim();
    const merchantKey = String(process.env.CIELO_MERCHANT_KEY || "").trim();
    const envName = String(process.env.CIELO_ENV || "production").trim();

    res.json({
      ok: true,
      env: envName,
      baseUrl: cieloBaseUrl(),
      merchantId_masked: maskId(merchantId),
      merchantKey_len: merchantKey.length,
      merchantKey_tail3: tail3(merchantKey), // compare com os 3 últimos do painel
    });
  });

  // POST /payments/cielo/credit
  app.post("/payments/cielo/credit", async (req, res) => {
    try {
      // ✅ aceita orderId e merchantOrderId (pra não te travar no front)
      const bodyIn = req.body || {};
      const orderId = bodyIn.orderId || bodyIn.merchantOrderId;

      const amount = bodyIn.amount;
      const installments = bodyIn.installments ?? 1;

      // aceita customer.name OU name direto
      const customerName = String(bodyIn?.customer?.name || bodyIn?.name || "Cliente").trim();

      const card = bodyIn.card || bodyIn.creditCard || {};
      const cents = moneyToCents(amount);

      const cardNumber = onlyDigits(card?.number || card?.cardNumber);
      const holder = String(card?.holder || card?.Holder || "").trim();
      const exp = normalizeExp(card?.expiration || card?.expirationDate || card?.ExpirationDate);
      const cvv = onlyDigits(card?.cvv || card?.securityCode || card?.SecurityCode);
      const brand = String(card?.brand || card?.Brand || "").trim();

      if (cardNumber.length < 13) throw new Error("card.number inválido");
      if (!holder) throw new Error("card.holder é obrigatório");
      if (cvv.length < 3 || cvv.length > 4) throw new Error("card.cvv inválido");

      const inst = Number(installments);
      if (!Number.isFinite(inst) || inst < 1 || inst > 12) throw new Error("installments inválido (1..12)");

      const captureAuto =
        String(env("CIELO_CAPTURE_AUTO", false, "false")).toLowerCase().trim() === "true";

      const softDescriptor =
        String(env("CIELO_SOFT_DESCRIPTOR", false, "ARIANAMOVEIS"))
          .trim()
          .slice(0, 13);

      if (!orderId) throw new Error("orderId é obrigatório");

      const reqBody = {
        MerchantOrderId: String(orderId),
        Customer: { Name: customerName },
        Payment: {
          Type: "CreditCard",
          Amount: cents,
          Installments: inst,
          Capture: captureAuto,
          SoftDescriptor: softDescriptor,
          CreditCard: {
            CardNumber: cardNumber,
            Holder: holder,
            ExpirationDate: exp,
            SecurityCode: cvv,
            Brand: brand || undefined,
          },
        },
      };

      const data = await cieloRequest("post", "/1/sales/", reqBody);

      res.json({
        ok: true,
        env: String(process.env.CIELO_ENV || "production").trim(),
        baseUrl: cieloBaseUrl(),
        paymentId: data?.Payment?.PaymentId || null,
        status: data?.Payment?.Status ?? null,
        returnCode: data?.Payment?.ReturnCode || null,
        returnMessage: data?.Payment?.ReturnMessage || null,
        raw: data,
      });
    } catch (e) {
      res.status(e.status || 500).json({
        ok: false,
        stage: "payments/cielo/credit",
        error: e?.message || String(e),
        details: e?.details || null,
      });
    }
  });

  // POST /payments/cielo/capture
  app.post("/payments/cielo/capture", async (req, res) => {
    try {
      const { paymentId, amount } = req.body || {};
      if (!paymentId) throw new Error("paymentId é obrigatório");
      const cents = amount ? moneyToCents(amount) : null;

      const path = cents
        ? `/1/sales/${paymentId}/capture?amount=${cents}`
        : `/1/sales/${paymentId}/capture`;

      const data = await cieloRequest("put", path, null);
      res.json({ ok: true, raw: data });
    } catch (e) {
      res.status(e.status || 500).json({
        ok: false,
        stage: "payments/cielo/capture",
        error: e?.message || String(e),
        details: e?.details || null,
      });
    }
  });
};
