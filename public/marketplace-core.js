// ============================================================
// Resolve imagem principal do produto (compatível com Mongo/Render)
// Suporta: imageUrl, mainImageUrl, imagens[], images[] (com {url,isMain})
// ============================================================
function getProductImageUrl(p) {
  if (!p) return null;

  const direct = p.imageUrl || p.mainImageUrl || p.imagemUrl || p.imagem || p.foto || p.thumbnailUrl;
  if (direct) return direct;

  const arr = (Array.isArray(p.images) && p.images.length) ? p.images
    : ((Array.isArray(p.imagens) && p.imagens.length) ? p.imagens
    : ((Array.isArray(p.gallery) && p.gallery.length) ? p.gallery : null));

  if (arr) {
    const mainObj = arr.find(x => x && typeof x === 'object' && (x.isMain === true || x.main === true || x.principal === true));
    if (mainObj && (mainObj.url || mainObj.src)) return mainObj.url || mainObj.src;

    const firstObj = arr.find(x => x && typeof x === 'object' && (x.url || x.src));
    if (firstObj) return firstObj.url || firstObj.src;

    const firstStr = arr.find(x => typeof x === 'string' && x.startsWith('http'));
    if (firstStr) return firstStr;
  }

  if (p.url && String(p.url).startsWith('http')) return p.url;

  return null;
}

/**
 * Componente de Card de Produto Ariana Móveis
 * Mantém o padrão visual do index.html em todo o site.
 *
 * ✅ Suporta:
 * - Preço antigo (oldPrice / precoAntigo) -> calcula % OFF
 * - Desconto no PIX (pixDiscountPercent / descontoPixPercent) -> exibe preço no PIX
 * - Parcelamento no cartão (installments / installmentsCount / parcelas) -> exibe texto de parcelas
 */
(function () {
  const API_BASE =
    localStorage.getItem("API_BASE") ||
    "https://ariana-move-mongo.onrender.com/api";

  const toNumber = (v) => {
    const n = window.__toNumberBR ? window.__toNumberBR(v, NaN) : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  // ============================
  // Configuração GLOBAL de Pagamentos
  // ============================
  const DEFAULT_PAYMENT_SETTINGS = {
    pix: { enabled: true, discountPercent: 0, label: 'PIX' },
    boleto: { enabled: false, discountPercent: 0, label: 'Boleto' },
    card: { enabled: true, maxInstallments: 12, interestFree: true }
  };

  const normalizePaymentSettings = (raw) => {
    const s = raw && typeof raw === 'object' ? raw : {};
    const pix = s.pix && typeof s.pix === 'object' ? s.pix : {};
    const boleto = s.boleto && typeof s.boleto === 'object' ? s.boleto : {};
    const card = s.card && typeof s.card === 'object' ? s.card : {};
    return {
      pix: {
        enabled: pix.enabled !== undefined ? !!pix.enabled : DEFAULT_PAYMENT_SETTINGS.pix.enabled,
        discountPercent: toNumber(pix.discountPercent) ?? DEFAULT_PAYMENT_SETTINGS.pix.discountPercent,
        label: (pix.label || DEFAULT_PAYMENT_SETTINGS.pix.label).toString()
      },
      boleto: {
        enabled: boleto.enabled !== undefined ? !!boleto.enabled : DEFAULT_PAYMENT_SETTINGS.boleto.enabled,
        discountPercent: toNumber(boleto.discountPercent) ?? DEFAULT_PAYMENT_SETTINGS.boleto.discountPercent,
        label: (boleto.label || DEFAULT_PAYMENT_SETTINGS.boleto.label).toString()
      },
      card: {
        enabled: card.enabled !== undefined ? !!card.enabled : DEFAULT_PAYMENT_SETTINGS.card.enabled,
        maxInstallments: Math.max(1, Math.min(24, Math.floor(toNumber(card.maxInstallments) ?? DEFAULT_PAYMENT_SETTINGS.card.maxInstallments))),
        interestFree: card.interestFree !== undefined ? !!card.interestFree : DEFAULT_PAYMENT_SETTINGS.card.interestFree
      }
    };
  };

  window.__PAYMENT_SETTINGS = window.__PAYMENT_SETTINGS || null;
  window.__PAYMENT_SETTINGS_LOADING = window.__PAYMENT_SETTINGS_LOADING || null;

  window.getPaymentSettings = async function getPaymentSettings(force = false) {
    try {
      if (!force && window.__PAYMENT_SETTINGS) return window.__PAYMENT_SETTINGS;
      if (window.__PAYMENT_SETTINGS_LOADING && !force) return window.__PAYMENT_SETTINGS_LOADING;

      const loader = (async () => {
        try {
          const res = await fetch(`${API_BASE}/settings/payments`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
          });

          if (!res.ok) {
            window.__PAYMENT_SETTINGS = normalizePaymentSettings(null);
            return window.__PAYMENT_SETTINGS;
          }

          const data = await res.json();
          window.__PAYMENT_SETTINGS = normalizePaymentSettings(data);
          return window.__PAYMENT_SETTINGS;
        } catch (e) {
          console.warn('[payments] falha ao carregar settings/payments no Mongo. Usando padrão.', e);
          window.__PAYMENT_SETTINGS = normalizePaymentSettings(null);
          return window.__PAYMENT_SETTINGS;
        } finally {
          window.__PAYMENT_SETTINGS_LOADING = null;
        }
      })();

      window.__PAYMENT_SETTINGS_LOADING = loader;
      return loader;
    } catch (e) {
      window.__PAYMENT_SETTINGS = normalizePaymentSettings(null);
      window.__PAYMENT_SETTINGS_LOADING = null;
      return window.__PAYMENT_SETTINGS;
    }
  };

  // ============================================================
// Lógica para Salvar Chamados de Suporte no MongoDB
// ============================================================
window.saveTicket = async function(ticketData) {
    const API_BASE = localStorage.getItem("API_BASE") || "https://ariana-move-mongo.onrender.com/api";
    
    try {
        const response = await fetch(`${API_BASE}/tickets`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Se você já tiver o token de login do cliente:
                'Authorization': `Bearer ${localStorage.getItem('userToken')}`
            },
            body: JSON.stringify(ticketData)
        });

        if (!response.ok) throw new Error('Falha ao salvar chamado');
        
        return await response.json();
    } catch (error) {
        console.error('Erro ao enviar chamado:', error);
        throw error;
    }
};

  try { window.getPaymentSettings(false); } catch (_) {}

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  window.addEventListener('DOMContentLoaded', () => {
    try { window.getPaymentSettings(true); } catch (_) {}
  });

  const formatCurrency = (v) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

  const pick = (obj, keys) => {
    for (const k of keys) {
      const v = obj?.[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return null;
  };

  const getOldPrice = (p, price) => {
    const v = toNumber(p.oldPrice ?? p.precoAntigo ?? p.preco_anterior ?? p.precoDe ?? p.priceOld ?? null);
    if (v && price && v > price) return v;
    return null;
  };

  const getPixPercent = (p) => {
    const raw = pick(p, ['pixDiscountPercent', 'descontoPixPercent', 'pix_percent', 'pixDescontoPercent', 'pixDiscount']);
    const v = toNumber(raw);
    if (v && v > 0) return clamp(v, 0, 90);

    const s = window.__PAYMENT_SETTINGS;
    if (s?.pix?.enabled) {
      const gv = toNumber(s.pix.discountPercent) || 0;
      if (gv > 0) return clamp(gv, 0, 90);
    }
    return 0;
  };

  const getBoletoPercent = (p) => {
    const raw = pick(p, ['boletoDiscountPercent', 'descontoBoletoPercent', 'boleto_percent', 'boletoDiscount']);
    const v = toNumber(raw);
    if (v && v > 0) return clamp(v, 0, 90);

    const s = window.__PAYMENT_SETTINGS;
    if (s?.boleto?.enabled) {
      const gv = toNumber(s.boleto.discountPercent) || 0;
      if (gv > 0) return clamp(gv, 0, 90);
    }
    return 0;
  };

  const calcDiscountPercent = (oldPrice, price) => {
    if (!oldPrice || !price || oldPrice <= 0 || price <= 0 || oldPrice <= price) return 0;
    return clamp(Math.round(((oldPrice - price) / oldPrice) * 100), 0, 95);
  };

  const getInstallments = (p, price) => {
    const obj = (p.installments && typeof p.installments === 'object') ? p.installments : null;

    const count =
      toNumber(obj?.count) ??
      toNumber(p.installmentsCount ?? p.parcelas ?? p.parcelamento ?? null) ??
      (window.__PAYMENT_SETTINGS?.card?.enabled ? (toNumber(window.__PAYMENT_SETTINGS?.card?.maxInstallments) ?? 10) : 10);

    const interestFree =
      (obj?.interestFree !== undefined ? !!obj.interestFree :
        (p.installmentsInterestFree !== undefined ? !!p.installmentsInterestFree :
          (p.parcelasSemJuros !== undefined ? !!p.parcelasSemJuros :
            (window.__PAYMENT_SETTINGS?.card?.enabled ? !!window.__PAYMENT_SETTINGS?.card?.interestFree : true))));

    const value =
      toNumber(obj?.value) ??
      toNumber(p.installmentsValue ?? p.valorParcela ?? p.parcelaValor ?? null) ??
      (price && count ? (price / count) : null);

    return { count: clamp(Math.round(count || 10), 1, 24), value: value || 0, interestFree };
  };

  const buildInstallmentsText = (inst) => {
    if (!inst?.count || !inst?.value) return 'em até 10x';
    const interestText = inst.interestFree ? 'sem juros' : 'c/ juros';
    return `${inst.count}x de ${formatCurrency(inst.value)} ${interestText}`;
  };

  // ==========================================
  // Decorator: injeta pagamentos no produto (uso site inteiro)
  // ==========================================
  window.decorateProductWithPayments = function decorateProductWithPayments(product) {
    const price = toNumber(product?.price ?? product?.preco ?? product?.valor ?? 0) || 0;

    const oldPrice = getOldPrice(product || {}, price);
    const descontoPercent = calcDiscountPercent(oldPrice, price);

    const pixPercent = getPixPercent(product || {});
    const pixPrice = pixPercent > 0 ? (price * (1 - pixPercent / 100)) : null;

    const boletoPercent = getBoletoPercent(product || {});
    const boletoPrice = boletoPercent > 0 ? (price * (1 - boletoPercent / 100)) : null;

    const installments = getInstallments(product || {}, price);

    const cash = {
      enabled: true,
      price: (pixPrice && pixPrice > 0) ? pixPrice : price,
      discountPercent: (pixPrice && pixPrice > 0) ? pixPercent : (descontoPercent || 0),
      label: (window.__PAYMENT_SETTINGS?.pix?.label || 'PIX')
    };

    const card = {
      enabled: true,
      installments,
      text: `ou em até ${installments.count}x de ${formatCurrency(installments.value)} ${installments.interestFree ? 'sem juros' : 'c/ juros'}`
    };

    const decorated = { ...(product || {}) };
    decorated.price = price;
    decorated.oldPrice = oldPrice;
    decorated.__payments = {
      cash,
      card,
      boleto: { enabled: !!boletoPrice, price: boletoPrice, discountPercent: boletoPercent }
    };
    return decorated;
  };

  const buildBoletoHtml = (boletoPrice, boletoPercent) => {
    if (!boletoPrice || boletoPrice <= 0 || !boletoPercent || boletoPercent <= 0) return '';
    return `<p class="text-[11px] text-emerald-600 font-bold mt-1">
              <i class="fas fa-barcode mr-1"></i> no Boleto: ${formatCurrency(boletoPrice)} <span class="font-black">(${boletoPercent}% OFF)</span>
            </p>`;
  };

  window.createProductCard = function (p) {
    const price = toNumber(p.price ?? p.preco ?? p.valor ?? 0) || 0;
    const productId = p._id || p.id || '';

    const oldPrice = getOldPrice(p, price);
    const descontoPercent = calcDiscountPercent(oldPrice, price);

    const pixPercent = getPixPercent(p);
    const pixPrice = pixPercent > 0 ? (price * (1 - pixPercent / 100)) : null;

    const boletoPercent = getBoletoPercent(p);
    const boletoPrice = boletoPercent > 0 ? (price * (1 - boletoPercent / 100)) : null;

    const boletoHtml = buildBoletoHtml(boletoPrice, boletoPercent);

    const installments = getInstallments(p, price);
    const installmentsText = buildInstallmentsText(installments);

    const rating = (p.rating ?? p.avaliacao ?? '4.9');
    const imageUrl = getProductImageUrl(p) || 'https://placehold.co/400';

    const oldPriceHtml = oldPrice ? `<span class="block text-xs text-gray-400 line-through">${formatCurrency(oldPrice)}</span>` : '';

    const pixHtml = (pixPrice && pixPrice > 0)
      ? `<p class="text-[11px] text-emerald-600 font-bold mt-1">
            <i class="fas fa-bolt mr-1"></i> no PIX: ${formatCurrency(pixPrice)} <span class="font-black">(${pixPercent}% OFF)</span>
         </p>`
      : '';

    const badgeHtml = descontoPercent > 0 ? `
      <div class="absolute top-3 left-3 bg-red-600 text-white text-[10px] font-bold px-2 py-1 rounded-full z-10">
        -${descontoPercent}% OFF
      </div>` : '';

    return `
      <div class="product-card bg-white rounded-xl overflow-hidden flex flex-col cursor-pointer relative border border-gray-100 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:border-primary-blue"
           onclick="window.location.href='produto.html?id=${productId}'">

        ${badgeHtml}

        <div class="p-4 bg-white flex items-center justify-center h-56 relative group">
          <img src="${imageUrl}"
               alt="${(p.name || p.nome || 'Produto').toString().replace(/"/g, '&quot;')}"
               class="max-h-full max-w-full object-contain transition-transform duration-500 group-hover:scale-110">

          <button onclick="event.stopPropagation(); if(window.addToWishlist) window.addToWishlist('${productId}')"
                  class="absolute top-2 right-2 text-gray-300 hover:text-red-500 transition-colors">
            <i class="fas fa-heart"></i>
          </button>
        </div>

        <div class="p-5 flex flex-col flex-grow border-t border-gray-50">
          <div class="flex items-center mb-1">
            <div class="flex text-yellow-400 text-[10px]">
              <i class="fas fa-star"></i><i class="fas fa-star"></i><i class="fas fa-star"></i><i class="fas fa-star"></i><i class="fas fa-star"></i>
            </div>
            <span class="text-[10px] text-gray-400 ml-2">(${rating})</span>
          </div>

          <h3 class="text-sm font-medium text-gray-800 line-clamp-2 mb-3 h-10 leading-tight">${p.name || p.nome || 'Produto sem nome'}</h3>

          <div class="mb-4">
            ${oldPriceHtml}
            <div class="flex items-baseline gap-2">
              <span class="text-xl font-extrabold text-primary-blue">${formatCurrency(price)}</span>
            </div>

            ${pixHtml}
            ${boletoHtml}

            <p class="text-[11px] text-success-green font-semibold mt-1">
              <i class="fas fa-credit-card mr-1"></i> ${installmentsText}
            </p>
          </div>

          <div class="mt-auto space-y-2">
            <div class="flex items-center text-[10px] text-gray-500 bg-gray-50 p-1.5 rounded">
              <i class="fas fa-truck text-primary-blue mr-2"></i>
              <span>Frete Grátis <span class="font-bold text-dark-bg">Sul e Sudeste</span></span>
            </div>
            <button onclick="event.stopPropagation(); if(window.addToCart) window.addToCart('${productId}')"
                    class="w-full bg-primary-blue hover:bg-dark-bg text-white font-bold py-2.5 rounded-lg text-[11px] transition-colors flex items-center justify-center gap-2">
              <i class="fas fa-shopping-bag"></i> ADICIONAR AO CARRINHO
            </button>
          </div>
        </div>
      </div>`;
  };
})();
