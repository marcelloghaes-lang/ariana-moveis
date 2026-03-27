
const API_BASE = localStorage.getItem("API_BASE") || "https://ariana-move-mongo.onrender.com/api";
(function () {

  const toNumber = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  // ============================
  // CONFIG PADRÃO DE PAGAMENTOS
  // ============================
  const DEFAULT_PAYMENT_SETTINGS = {
    pix: { enabled: true, discountPercent: 0, label: 'PIX' },
    boleto: { enabled: false, discountPercent: 0, label: 'Boleto' },
    card: { enabled: true, maxInstallments: 12, interestFree: true }
  };

  const normalizePaymentSettings = (raw) => {
    const s = raw && typeof raw === 'object' ? raw : {};
    const pix = s.pix || {};
    const boleto = s.boleto || {};
    const card = s.card || {};

    return {
      pix: {
        enabled: pix.enabled ?? DEFAULT_PAYMENT_SETTINGS.pix.enabled,
        discountPercent: toNumber(pix.discountPercent) ?? DEFAULT_PAYMENT_SETTINGS.pix.discountPercent,
        label: pix.label || DEFAULT_PAYMENT_SETTINGS.pix.label
      },
      boleto: {
        enabled: boleto.enabled ?? DEFAULT_PAYMENT_SETTINGS.boleto.enabled,
        discountPercent: toNumber(boleto.discountPercent) ?? DEFAULT_PAYMENT_SETTINGS.boleto.discountPercent,
        label: boleto.label || DEFAULT_PAYMENT_SETTINGS.boleto.label
      },
      card: {
        enabled: card.enabled ?? DEFAULT_PAYMENT_SETTINGS.card.enabled,
        maxInstallments: Math.max(1, Math.min(24, Math.floor(toNumber(card.maxInstallments) ?? 12))),
        interestFree: card.interestFree ?? true
      }
    };
  };

  window.__PAYMENT_SETTINGS = null;

  window.getPaymentSettings = async function () {
    try {
      const res = await fetch(API_BASE + "/settings/payments");
      const data = await res.json();
      window.__PAYMENT_SETTINGS = normalizePaymentSettings(data || null);
    } catch (e) {
      console.warn("Erro ao carregar pagamentos, usando padrão");
      window.__PAYMENT_SETTINGS = normalizePaymentSettings(null);
    }
    return window.__PAYMENT_SETTINGS;
  };

  // carregar em background
  try { window.getPaymentSettings(); } catch (_) {}

  // ============================
  // UTIL
  // ============================

  const formatCurrency = (v) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL"
    }).format(v || 0);

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  const pick = (obj, keys) => {
    for (const k of keys) {
      const v = obj?.[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    }
    return null;
  };

  const getOldPrice = (p, price) => {
    const v = toNumber(p.oldPrice ?? p.precoAntigo ?? p.precoDe);
    if (v && v > price) return v;
    return null;
  };

  const calcDiscountPercent = (oldPrice, price) => {
    if (!oldPrice || !price || oldPrice <= price) return 0;
    return clamp(Math.round(((oldPrice - price) / oldPrice) * 100), 0, 95);
  };

  const getPixPercent = (p) => {
    const raw = pick(p, ["pixDiscountPercent", "descontoPixPercent"]);
    const v = toNumber(raw);
    if (v && v > 0) return clamp(v, 0, 90);

    const s = window.__PAYMENT_SETTINGS;
    if (s?.pix?.enabled) {
      return clamp(toNumber(s.pix.discountPercent) || 0, 0, 90);
    }
    return 0;
  };

  const getBoletoPercent = (p) => {
    const raw = pick(p, ["boletoDiscountPercent", "descontoBoletoPercent"]);
    const v = toNumber(raw);
    if (v && v > 0) return clamp(v, 0, 90);

    const s = window.__PAYMENT_SETTINGS;
    if (s?.boleto?.enabled) {
      return clamp(toNumber(s.boleto.discountPercent) || 0, 0, 90);
    }
    return 0;
  };

  const getInstallments = (p, price) => {
    const count = toNumber(p.installmentsCount ?? p.parcelas ?? 10);
    const value = price / (count || 10);

    return {
      count: clamp(Math.round(count || 10), 1, 24),
      value,
      interestFree: true
    };
  };

  const buildInstallmentsText = (inst) => {
    return `${inst.count}x de ${formatCurrency(inst.value)} sem juros`;
  };

  // ============================
  // CARD
  // ============================

  window.createProductCard = function (p) {

    const price = toNumber(p.price ?? p.preco ?? 0) || 0;

    const oldPrice = getOldPrice(p, price);
    const descontoPercent = calcDiscountPercent(oldPrice, price);

    const pixPercent = getPixPercent(p);
    const pixPrice = pixPercent > 0 ? (price * (1 - pixPercent / 100)) : null;

    const boletoPercent = getBoletoPercent(p);
    const boletoPrice = boletoPercent > 0 ? (price * (1 - boletoPercent / 100)) : null;

    const installments = getInstallments(p, price);
    const installmentsText = buildInstallmentsText(installments);

    const rating = p.rating ?? "4.9";
    const imageUrl = p.mainImageUrl || p.imageUrl || "https://placehold.co/400";

    const oldPriceHtml = oldPrice
      ? `<span class="block text-xs text-gray-400 line-through">${formatCurrency(oldPrice)}</span>`
      : "";

    const pixHtml = pixPrice
      ? `<p class="text-[11px] text-emerald-600 font-bold mt-1">
            no PIX: ${formatCurrency(pixPrice)} (${pixPercent}% OFF)
         </p>`
      : "";

    const boletoHtml = boletoPrice
      ? `<p class="text-[11px] text-blue-600 font-bold mt-1">
            no Boleto: ${formatCurrency(boletoPrice)}
         </p>`
      : "";

    const badgeHtml = descontoPercent > 0
      ? `<div class="absolute top-3 left-3 bg-red-600 text-white text-[10px] font-bold px-2 py-1 rounded-full">
           -${descontoPercent}% OFF
         </div>`
      : "";

    return `
      <div class="product-card" onclick="window.location.href='produto.html?id=${p._id || p.id}'">

        ${badgeHtml}

        <div class="product-image-container">
          <img src="${imageUrl}" alt="${p.name || "Produto"}">
        </div>

        <div class="product-card-body">

          <div class="product-name">
            ${p.name || "Produto sem nome"}
          </div>

          ${oldPriceHtml}

          <div class="product-price">
            ${formatCurrency(price)}
          </div>

          ${pixHtml}
          ${boletoHtml}

          <div class="product-installments">
            ${installmentsText}
          </div>

        </div>
      </div>
    `;
  };

})();