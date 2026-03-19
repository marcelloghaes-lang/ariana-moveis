/* eslint-disable */
const axios = require("axios");

// ================= HELPERS =================
function env(name, required = true, fallback = undefined) {
  const v = process.env[name] ?? fallback;
  if (required && (v === undefined || v === null || String(v).trim() === "")) {
    throw new Error(`ENV faltando: ${name}`);
  }
  return v;
}

function parseServices(raw) {
  const s = String(raw || "").trim();
  if (!s) return ["03220", "03298", "03212"]; // fallback padrão
  return s
    .split(/[;, ]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function onlyDigits(v) {
  return String(v || "").replace(/\D/g, "");
}

function toGrams(pesoKg) {
  const n = Number(pesoKg);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(Math.round(n * 1000));
}

function isPositiveNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}

function getCorreiosCfg() {
  const services = parseServices(process.env.CORREIOS_SERVICOS);

  return {
    BASE_HOST: "https://api.correios.com.br",

    CONTRATO: env("CORREIOS_CONTRATO"),
    CARTAO: env("CORREIOS_CARTAO"),

    // Você exigiu estes no .env (não são usados no token, mas mantemos como obrigatórios)
    PORTAL_USER: env("CORREIOS_USUARIO"),
    PORTAL_PASS: env("CORREIOS_SENHA"),

    // Credenciais da API (essas autenticam o TOKEN)
    API_USER: env("CORREIOS_API_USUARIO"),
    API_PASS: env("CORREIOS_API_SENHA"),

    ORIGIN_CEP: env("LOJA_ORIGEM_CEP"),
    DR: Number(env("CORREIOS_DR", false, "0")),

    SERVICES_DEFAULT: services,

    TOKEN_URL: "https://api.correios.com.br/token/v1/autentica/cartaopostagem",
    PRECO_URL: "https://api.correios.com.br/preco/v1/nacional",
  };
}

// ================= TOKEN =================
let tokenCache = { token: null, exp: 0 };

async function getCorreiosToken() {
  const cfg = getCorreiosCfg();
  const now = Date.now();

  if (tokenCache.token && tokenCache.exp > now) return tokenCache.token;

  const auth = Buffer.from(`${cfg.API_USER}:${cfg.API_PASS}`).toString("base64");

  const r = await axios.post(
    cfg.TOKEN_URL,
    { numero: cfg.CARTAO },
    {
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    }
  );

  const expiresIn = Number(r.data?.expires_in || 3000);
  tokenCache.token = r.data.token;
  tokenCache.exp = now + Math.max(60, expiresIn - 60) * 1000;

  return tokenCache.token;
}

// ================= COTAÇÃO (POST /preco/v1/nacional) =================
async function quoteCorreios(params) {
  const cfg = getCorreiosCfg();
  const token = await getCorreiosToken();

  const cepOrigem = onlyDigits(cfg.ORIGIN_CEP);
  const cepDestino = onlyDigits(params.cepDestino);

  if (cepOrigem.length !== 8) throw new Error("CEP de origem inválido (LOJA_ORIGEM_CEP).");
  if (cepDestino.length !== 8) throw new Error("cepDestino inválido (precisa ter 8 dígitos).");

  const psObjeto = toGrams(params.pesoKg);
  if (!psObjeto) throw new Error("pesoKg inválido (ex: 0.3, 1, 2.5).");

  const temDimensoes =
    isPositiveNumber(params.comprimento) &&
    isPositiveNumber(params.largura) &&
    isPositiveNumber(params.altura);

  // tpObjeto: 1 envelope, 2 pacote
  const tpObjeto = temDimensoes ? "2" : "1";

  const idLote = String(Date.now()); // sempre envia (seu erro provou que está sendo exigido)

  const parametrosProduto = cfg.SERVICES_DEFAULT.map((coProduto, idx) => {
    const item = {
      coProduto: String(coProduto),
      nuRequisicao: String(idx + 1).padStart(4, "0"),
      cepOrigem,
      cepDestino,
      psObjeto,
      tpObjeto,
    };

    // Só manda contrato/DR se tiver valor (evita mandar vazio)
    const nuContrato = String(cfg.CONTRATO || "").trim();
    if (nuContrato) item.nuContrato = nuContrato;

    const nuDR = Number(cfg.DR);
    if (Number.isFinite(nuDR) && nuDR > 0) item.nuDR = nuDR;

    // Dimensões só quando for pacote (tpObjeto=2)
    if (tpObjeto === "2") {
      item.comprimento = String(Math.round(Number(params.comprimento)));
      item.largura = String(Math.round(Number(params.largura)));
      item.altura = String(Math.round(Number(params.altura)));
    }

    // Campo que aparece no exemplo do manual (pode ser vazio)
    item.nuUnidade = "";

    return item;
  });

  const body = { idLote, parametrosProduto };

  const r = await axios.post(cfg.PRECO_URL, body, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: 20000,
  });

  return r.data;
}

// ================= ROTAS =================
module.exports = (app) => {
  app.get("/correios/token-test", async (_req, res) => {
    try {
      const token = await getCorreiosToken();
      res.json({ ok: true, token: token.slice(0, 12) + "..." });
    } catch (e) {
      res.status(500).json({
        ok: false,
        stage: "token",
        status: e?.response?.status || null,
        error: e?.message || String(e),
        details: e?.response?.data || null,
      });
    }
  });

  app.post("/correios/quote", async (req, res) => {
    try {
      const data = await quoteCorreios(req.body);
      res.json({ ok: true, data });
    } catch (e) {
      res.status(500).json({
        ok: false,
        stage: "quote",
        message: "Erro ao calcular frete",
        status: e?.response?.status || null,
        error: e?.message || String(e),
        details: e?.response?.data || null,
      });
    }
  });
};
