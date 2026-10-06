/* eslint-disable */
export default function registerCieloRoutes(app, context = {}) {
  const {
    Order,
    axios,
    adminRequired,
    writeAuditLog,
    redact,
    toJSON,
    now
  } = context;

  function env(name, required = false, fallback = undefined) {
    const value = process.env[name] ?? fallback;
    const text = value == null ? "" : String(value);
    if (required && !text.trim()) throw new Error(`ENV faltando: ${name}`);
    return text;
  }

  function onlyDigits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function removeAccents(value = "") {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function normalizeHolder(value = "") {
    const holder = removeAccents(value)
      .replace(/[^A-Za-z ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!holder) throw new Error("Nome do titular é obrigatório.");
    if (holder.length > 25) throw new Error("Nome do titular deve ter no máximo 25 caracteres.");
    return holder;
  }

  function normalizeCustomerName(value = "") {
    return removeAccents(value)
      .replace(/[^A-Za-z ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 255) || "Cliente";
  }

  function normalizeBrand(value = "") {
    const key = removeAccents(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");

    const supported = {
      visa: "Visa",
      master: "Master",
      mastercard: "Master",
      amex: "Amex",
      americanexpress: "Amex",
      elo: "Elo",
      aura: "Aura",
      jcb: "JCB",
      diners: "Diners",
      dinersclub: "Diners",
      discover: "Discover"
    };

    const brand = supported[key];
    if (!brand) {
      throw new Error(
        "Bandeira não suportada pela integração Cielo. Use Visa, Master, Amex, Elo, Aura, JCB, Diners ou Discover."
      );
    }
    return brand;
  }

  function luhnValid(cardNumber = "") {
    const digits = onlyDigits(cardNumber);
    if (digits.length < 13 || digits.length > 19) return false;

    let sum = 0;
    let doubleDigit = false;

    for (let i = digits.length - 1; i >= 0; i -= 1) {
      let n = Number(digits[i]);
      if (doubleDigit) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      doubleDigit = !doubleDigit;
    }

    return sum % 10 === 0;
  }

  function buildMerchantOrderId(orderId = "") {
    const base = String(orderId || "").replace(/[^A-Za-z0-9]/g, "") || "PEDIDO";
    const stamp = Date.now().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const random = Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z0-9]/g, "");

    // A Cielo pode gerar outro SentOrderId quando o identificador foge do formato esperado
    // ou é reutilizado. Mantemos até 20 caracteres alfanuméricos e geramos um ID novo
    // a cada tentativa, preservando a associação real pelo orderId do Mongo.
    return `${base.slice(-9)}${stamp.slice(-7)}${random.slice(-4)}`.slice(0, 20);
  }

  function sanitizeCieloData(value, depth = 0) {
    if (depth > 8) return "[max-depth]";
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map((item) => sanitizeCieloData(item, depth + 1));
    if (typeof value !== "object") return value;

    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const lower = String(key || "").toLowerCase();

      if (lower === "cardnumber") {
        const digits = onlyDigits(item);
        out[key] = digits ? `****${digits.slice(-4)}` : "****";
      } else if (lower === "securitycode" || lower === "cvv") {
        out[key] = "***";
      } else {
        out[key] = sanitizeCieloData(item, depth + 1);
      }
    }
    return out;
  }

  function getOrderAmount(order = null) {
    if (!order) return 0;

    const totals = order?.totals || {};
    const grand = Number(
      totals?.grandTotal ??
      totals?.total ??
      order?.total ??
      order?.amount ??
      0
    ) || 0;

    const original = Number(
      totals?.grandTotalOriginal ??
      totals?.totalOriginal ??
      order?.totalOriginal ??
      0
    ) || 0;

    const discount = Number(
      totals?.discountValue ??
      order?.discountValue ??
      0
    ) || 0;

    // Cartão usa o preço cheio. Se o pedido estiver salvo com desconto
    // de Pix/Boleto, cobra o grandTotalOriginal.
    if (original > 0 && (discount > 0 || original > grand)) {
      return original;
    }

    return grand;
  }

  function paymentAlreadyInProgressOrPaid(order = null) {
    if (!order) return false;

    const orderStatus = String(order?.status || "").toLowerCase().trim();
    const paymentStatus = String(order?.payment?.status || "").toLowerCase().trim();
    const paymentId = String(order?.payment?.paymentId || order?.payment?.externalId || "").trim();

    if (["pago", "paid", "payment_confirmed", "pagamento_autorizado"].includes(orderStatus)) {
      return true;
    }

    if (
      paymentId &&
      ["authorized", "paid", "pending", "paymentconfirmed", "payment_confirmed"].includes(paymentStatus)
    ) {
      return true;
    }

    return false;
  }

  function moneyToCents(amount) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) throw new Error("amount inválido");
    return Math.round(value * 100);
  }

  function normalizeExpiration(value) {
    const raw = String(value || "").trim();
    const parts = raw.split("/");
    if (parts.length !== 2) throw new Error("Validade inválida. Use MM/AAAA.");

    const month = String(parts[0] || "").padStart(2, "0");
    let year = String(parts[1] || "");

    if (!/^(0[1-9]|1[0-2])$/.test(month)) {
      throw new Error("Mês de validade do cartão inválido.");
    }

    if (year.length === 2) year = `20${year}`;
    if (!/^\d{4}$/.test(year)) {
      throw new Error("Validade inválida. Use MM/AAAA.");
    }

    const expYear = Number(year);
    const expMonth = Number(month);
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;

    if (expYear < currentYear || (expYear === currentYear && expMonth < currentMonth)) {
      throw new Error("Cartão vencido.");
    }

    return `${month}/${year}`;
  }

  function cieloBaseUrl() {
    const explicit = String(process.env.CIELO_API_URL || "").trim().replace(/\/+$/, "");
    if (explicit) return explicit;

    const mode = String(env("CIELO_ENV", false, "production")).toLowerCase().trim();
    if (["sandbox", "test", "teste"].includes(mode)) {
      return "https://apisandbox.cieloecommerce.cielo.com.br";
    }
    return "https://api.cieloecommerce.cielo.com.br";
  }

  function cieloEnvironment() {
    const mode = String(env("CIELO_ENV", false, "production")).toLowerCase().trim();
    return ["sandbox", "test", "teste"].includes(mode) ? "sandbox" : "production";
  }

  function cieloSopOAuthUrl() {
    return cieloEnvironment() === "sandbox"
      ? "https://authsandbox.braspag.com.br/oauth2/token"
      : "https://auth.braspag.com.br/oauth2/token";
  }

  function cieloSopAccessTokenUrl() {
    return cieloEnvironment() === "sandbox"
      ? "https://transactionsandbox.pagador.com.br/post/api/public/v2/accesstoken"
      : "https://transaction.pagador.com.br/post/api/public/v2/accesstoken";
  }

  async function getCieloSopAccessToken() {
    const clientId = String(env("CIELO_SOP_CLIENT_ID", true)).trim();
    const clientSecret = String(env("CIELO_SOP_CLIENT_SECRET", true)).trim();
    const merchantId = String(env("CIELO_MERCHANT_ID", true)).trim();

    const basic = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");

    const oauthResponse = await axios({
      method: "post",
      url: cieloSopOAuthUrl(),
      data: "grant_type=client_credentials",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      timeout: 30000,
      validateStatus: () => true
    });

    if (oauthResponse.status < 200 || oauthResponse.status >= 300) {
      const error = new Error(`Cielo SOP OAuth HTTP ${oauthResponse.status}`);
      error.status = oauthResponse.status;
      error.details = oauthResponse.data || null;
      throw error;
    }

    const oauthToken = String(oauthResponse.data?.access_token || "").trim();
    if (!oauthToken) {
      const error = new Error("A Cielo não retornou o access_token OAuth2 do Silent Order Post.");
      error.status = 502;
      throw error;
    }

    const sopResponse = await axios({
      method: "post",
      url: cieloSopAccessTokenUrl(),
      data: null,
      headers: {
        MerchantId: merchantId,
        Authorization: `Bearer ${oauthToken}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      timeout: 30000,
      validateStatus: () => true
    });

    if (sopResponse.status < 200 || sopResponse.status >= 300) {
      const error = new Error(`Cielo SOP AccessToken HTTP ${sopResponse.status}`);
      error.status = sopResponse.status;
      error.details = sopResponse.data || null;
      throw error;
    }

    const accessToken = String(sopResponse.data?.AccessToken || "").trim();
    if (!accessToken) {
      const error = new Error("A Cielo não retornou o AccessToken do Silent Order Post.");
      error.status = 502;
      throw error;
    }

    return {
      accessToken,
      environment: cieloEnvironment(),
      issued: sopResponse.data?.Issued || null,
      expiresIn: sopResponse.data?.ExpiresIn || null
    };
  }

  function mapStatus(value) {
    const status = Number(value);
    const values = {
      0:  { code: "not_finished", label: "Não finalizado", approved: false, captured: false },
      1:  { code: "authorized", label: "Pagamento autorizado", approved: true, captured: false },
      2:  { code: "paid", label: "Pagamento aprovado", approved: true, captured: true },
      3:  { code: "denied", label: "Pagamento recusado", approved: false, captured: false },
      10: { code: "voided", label: "Pagamento cancelado", approved: false, captured: false },
      11: { code: "refunded", label: "Pagamento estornado", approved: false, captured: false },
      12: { code: "pending", label: "Pagamento pendente", approved: false, captured: false },
      13: { code: "aborted", label: "Pagamento abortado", approved: false, captured: false },
      20: { code: "scheduled", label: "Pagamento agendado", approved: false, captured: false }
    };
    return values[status] || {
      code: "unknown",
      label: `Status Cielo ${status}`,
      approved: false,
      captured: false
    };
  }

  async function cieloRequest(method, path, body) {
    const merchantId = String(env("CIELO_MERCHANT_ID", true)).trim();
    const merchantKey = String(env("CIELO_MERCHANT_KEY", true)).trim();

    const response = await axios({
      method,
      url: `${cieloBaseUrl()}${path}`,
      data: body,
      headers: {
        MerchantId: merchantId,
        MerchantKey: merchantKey,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      timeout: 30000,
      validateStatus: () => true
    });

    if (response.status < 200 || response.status >= 300) {
      const error = new Error(`Cielo HTTP ${response.status}`);
      error.status = response.status;
      error.details = response.data || null;
      throw error;
    }

    return {
      status: response.status,
      data: response.data || {}
    };
  }

  function buildCreditPayload(body = {}, order = null) {
    if (!order) {
      const error = new Error("Pedido não encontrado.");
      error.status = 404;
      throw error;
    }

    const orderId = String(order?._id || order?.id || "").trim();
    if (!orderId) throw new Error("orderId é obrigatório");

    // Segurança financeira: o valor cobrado vem exclusivamente do pedido salvo no banco.
    // Nunca confia em body.amount/body.total enviados pelo navegador.
    const amount = getOrderAmount(order);
    const amountCents = moneyToCents(amount);

    const installments = Number(body.installments ?? 1);
    if (!Number.isInteger(installments) || installments < 1 || installments > 12) {
      throw new Error("Parcelas inválidas. Use de 1 a 12.");
    }

    if (installments > 1 && Math.floor(amountCents / installments) < 500) {
      throw new Error("Cada parcela deve ter valor mínimo de R$ 5,00.");
    }

    const paymentToken = String(
      body.paymentToken ||
      body.PaymentToken ||
      body?.card?.paymentToken ||
      body?.card?.PaymentToken ||
      ""
    ).trim();

    if (!/^[0-9a-fA-F-]{36}$/.test(paymentToken)) {
      throw new Error("PaymentToken da Cielo inválido ou ausente.");
    }

    const capture =
      String(env("CIELO_CAPTURE_AUTO", false, "false")).toLowerCase().trim() === "true";

    const softDescriptor = removeAccents(
      env("CIELO_SOFT_DESCRIPTOR", false, "ARIANAMOVEIS")
    )
      .replace(/[^A-Za-z0-9]/g, "")
      .trim()
      .slice(0, 13) || "ARIANAMOVEIS";

    const customerName = normalizeCustomerName(
      order?.customer?.name ||
      order?.customerName ||
      body?.customer?.name ||
      body?.name ||
      "Cliente"
    );

    const merchantOrderId = buildMerchantOrderId(orderId);

    const payload = {
      MerchantOrderId: merchantOrderId,
      Customer: {
        Name: customerName
      },
      Payment: {
        Type: "CreditCard",
        Amount: amountCents,
        Currency: "BRL",
        Country: "BRA",
        Installments: installments,
        Interest: "ByMerchant",
        Capture: capture,
        SoftDescriptor: softDescriptor,
        CreditCard: {
          PaymentToken: paymentToken
        }
      }
    };

    // O backend recebe somente PaymentToken; PAN/CVV não passam pelo servidor da loja.
    const safeAudit = sanitizeCieloData(payload);

    return {
      orderId,
      merchantOrderId,
      payload,
      safeAudit
    };
  }

  async function updateOrderFromCielo(orderId, cieloData = {}) {
    if (!Order || !orderId) return null;

    try {
      const payment = cieloData?.Payment || {};
      const mapped = mapStatus(payment.Status);
      const updatedAt = typeof now === "function" ? now() : new Date();

      const patch = {
        "payment.provider": "cielo",
        "payment.method": "card",
        "payment.type": "credit_card",
        "payment.paymentId": String(payment.PaymentId || ""),
        "payment.externalId": String(payment.PaymentId || ""),
        "payment.status": mapped.code,
        "payment.statusDetail": String(payment.ReturnMessage || mapped.label),
        "payment.installments": Number(payment.Installments || 1),
        "payment.amount": Number(payment.Amount || 0) / 100,
        "payment.authorizationCode": String(payment.AuthorizationCode || ""),
        "payment.proofOfSale": String(payment.ProofOfSale || ""),
        "payment.returnCode": String(payment.ReturnCode || ""),
        "payment.providerStatus": payment.Status,
        "payment.merchantOrderId": String(cieloData?.MerchantOrderId || ""),
        "payment.sentOrderId": String(cieloData?.Payment?.SentOrderId || cieloData?.SentOrderId || ""),
        "payment.updatedAt": updatedAt,
        status: mapped.captured
          ? "pago"
          : mapped.approved
            ? "pagamento_autorizado"
            : mapped.code === "denied"
              ? "pagamento_recusado"
              : "pending_payment",
        statusLabel: mapped.captured
          ? "Pagamento aprovado"
          : mapped.approved
            ? "Pagamento autorizado"
            : mapped.code === "denied"
              ? "Pagamento recusado"
              : "Aguardando confirmação do pagamento"
      };

      return await Order.findByIdAndUpdate(
        orderId,
        { $set: patch },
        { new: true }
      );
    } catch (error) {
      console.error("[CIELO] Erro ao atualizar pedido:", error?.message || error);
      return null;
    }
  }

  app.get("/api/admin/payments/cielo/debug", adminRequired, (_req, res) => {
    const merchantId = String(process.env.CIELO_MERCHANT_ID || "").trim();
    const merchantKey = String(process.env.CIELO_MERCHANT_KEY || "").trim();
    const sopClientId = String(process.env.CIELO_SOP_CLIENT_ID || "").trim();
    const sopClientSecret = String(process.env.CIELO_SOP_CLIENT_SECRET || "").trim();

    res.json({
      ok: true,
      env: String(process.env.CIELO_ENV || "production").trim(),
      baseUrl: cieloBaseUrl(),
      merchantIdConfigured: Boolean(merchantId),
      merchantKeyConfigured: Boolean(merchantKey),
      sopClientIdConfigured: Boolean(sopClientId),
      sopClientSecretConfigured: Boolean(sopClientSecret),
      captureAuto:
        String(process.env.CIELO_CAPTURE_AUTO || "false").toLowerCase() === "true"
    });
  });

  app.post("/api/payments/cielo/sop/access-token", async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");

      const requestedOrderId =
        req.body?.orderId ||
        req.body?.order_id ||
        null;

      if (!requestedOrderId) {
        return res.status(400).json({
          ok: false,
          provider: "cielo",
          stage: "payments/cielo/sop/access-token",
          error: "orderId é obrigatório",
          details: null
        });
      }

      const order =
        Order
          ? await Order.findById(requestedOrderId).catch(() => null)
          : null;

      if (!order) {
        return res.status(404).json({
          ok: false,
          provider: "cielo",
          stage: "payments/cielo/sop/access-token",
          error: "Pedido não encontrado.",
          details: null
        });
      }

      if (paymentAlreadyInProgressOrPaid(order)) {
        return res.status(409).json({
          ok: false,
          provider: "cielo",
          stage: "payments/cielo/sop/access-token",
          error: "Este pedido já possui pagamento autorizado, pendente ou confirmado.",
          details: null
        });
      }

      const token = await getCieloSopAccessToken();

      return res.status(201).json({
        ok: true,
        provider: "cielo",
        mode: "silent_order_post",
        environment: token.environment,
        accessToken: token.accessToken,
        issued: token.issued,
        expiresIn: token.expiresIn
      });
    } catch (error) {
      return res.status(error.status || 500).json({
        ok: false,
        provider: "cielo",
        stage: "payments/cielo/sop/access-token",
        error:
          error?.details?.error_description ||
          error?.details?.Message ||
          error?.details?.message ||
          error?.message ||
          String(error),
        details: sanitizeCieloData(error?.details || null)
      });
    }
  });

  app.post("/api/payments/cielo/credit", async (req, res) => {
    try {
      const body = req.body || {};
      const requestedOrderId =
        body.orderId ||
        body.order_id ||
        body.merchantOrderId ||
        null;

      if (!requestedOrderId) {
        return res.status(400).json({
          ok: false,
          approved: false,
          provider: "cielo",
          stage: "payments/cielo/credit",
          error: "orderId é obrigatório",
          details: null
        });
      }

      const order =
        Order && requestedOrderId
          ? await Order.findById(requestedOrderId).catch(() => null)
          : null;

      if (!order) {
        return res.status(404).json({
          ok: false,
          approved: false,
          provider: "cielo",
          stage: "payments/cielo/credit",
          error: "Pedido não encontrado.",
          details: null
        });
      }

      if (paymentAlreadyInProgressOrPaid(order)) {
        return res.status(409).json({
          ok: false,
          approved: false,
          provider: "cielo",
          stage: "payments/cielo/credit",
          error: "Este pedido já possui pagamento autorizado, pendente ou confirmado. A cobrança não foi repetida.",
          details: null
        });
      }

      const { orderId, merchantOrderId, payload, safeAudit } = buildCreditPayload(body, order);
      const response = await cieloRequest("post", "/1/sales/", payload);
      const cieloData = response.data || {};
      const payment = cieloData?.Payment || {};
      const mapped = mapStatus(payment.Status);

      const updatedOrder = await updateOrderFromCielo(orderId, cieloData);

      if (typeof writeAuditLog === "function") {
        await writeAuditLog({
          scope: "payments",
          eventType: "cielo_card_created",
          orderId,
          status: mapped.approved ? "success" : "error",
          statusCode: response.status,
          request: safeAudit,
          response:
            typeof redact === "function"
              ? redact(sanitizeCieloData(cieloData))
              : sanitizeCieloData(cieloData),
          metadata: {
            provider: "cielo",
            merchantOrderId,
            orderUpdated: Boolean(updatedOrder),
            cieloStatus: payment.Status,
            captured: mapped.captured
          }
        }).catch(() => null);
      }

      return res.status(response.status).json({
        ok: mapped.approved,
        approved: mapped.approved,
        captured: mapped.captured,
        provider: "cielo",
        method: "card",
        paymentMethod: "card",
        status: mapped.code,
        statusLabel: mapped.label,
        statusDetail: payment.ReturnMessage || mapped.label,
        paymentId: payment.PaymentId || null,
        id: payment.PaymentId || null,
        returnCode: payment.ReturnCode || null,
        returnMessage: payment.ReturnMessage || null,
        merchantOrderId: cieloData?.MerchantOrderId || merchantOrderId || null,
        sentOrderId: payment.SentOrderId || cieloData?.SentOrderId || null,
        order: updatedOrder
          ? (typeof toJSON === "function" ? toJSON(updatedOrder) : updatedOrder)
          : null
      });
    } catch (error) {
      return res.status(error.status || 500).json({
        ok: false,
        approved: false,
        provider: "cielo",
        stage: "payments/cielo/credit",
        error:
          error?.details?.[0]?.Message ||
          error?.details?.Message ||
          error?.message ||
          String(error),
        details: sanitizeCieloData(error?.details || null)
      });
    }
  });

  // Captura manual é operação financeira sensível; nunca deve ficar pública.
  app.post("/api/payments/cielo/capture", adminRequired, async (req, res) => {
    try {
      const { paymentId, amount, orderId } = req.body || {};
      if (!paymentId) throw new Error("paymentId é obrigatório");

      const path = amount
        ? `/1/sales/${encodeURIComponent(paymentId)}/capture?amount=${moneyToCents(amount)}`
        : `/1/sales/${encodeURIComponent(paymentId)}/capture`;

      const response = await cieloRequest("put", path, null);
      const payment = response.data?.Payment || response.data || {};
      const mapped = mapStatus(payment.Status);

      const updatedOrder = orderId
        ? await updateOrderFromCielo(orderId, { Payment: payment })
        : null;

      return res.json({
        ok: true,
        provider: "cielo",
        paymentId,
        status: mapped.code,
        statusLabel: mapped.label,
        order: updatedOrder
          ? (typeof toJSON === "function" ? toJSON(updatedOrder) : updatedOrder)
          : null
      });
    } catch (error) {
      return res.status(error.status || 500).json({
        ok: false,
        provider: "cielo",
        stage: "payments/cielo/capture",
        error:
          error?.details?.[0]?.Message ||
          error?.details?.Message ||
          error?.message ||
          String(error),
        details: sanitizeCieloData(error?.details || null)
      });
    }
  });
}
