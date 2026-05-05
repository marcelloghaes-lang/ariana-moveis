/*
 * Ariana Móveis - Correção visual da precificação no detalhe do produto
 * Mantém o padrão do card do index:
 * - preço antigo riscado
 * - preço principal no PIX com % OFF
 * - parcelamento em 12x no cartão calculado sobre o preço cheio
 * - total parcelado sem desconto PIX
 */
(function () {
  'use strict';

  const DEFAULT_PIX_PERCENT = 17;
  const DEFAULT_INSTALLMENTS = 12;

  function toNumberBR(value, fallback = 0) {
    try {
      if (value === null || value === undefined || value === '') return fallback;
      if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
      let s = String(value).trim();
      if (!s) return fallback;
      s = s.replace(/[R$\s]/g, '').replace(/[^0-9.,-]/g, '');
      const hasComma = s.includes(',');
      const hasDot = s.includes('.');
      if (hasComma && hasDot) s = s.replace(/\./g, '').replace(',', '.');
      else if (hasComma && !hasDot) s = s.replace(',', '.');
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(toNumberBR(value, 0));
  }

  function pickNumber(obj, keys, fallback = 0) {
    for (const key of keys) {
      const value = obj && obj[key];
      const n = toNumberBR(value, NaN);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return fallback;
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function getPixPercent(product) {
    const fromProduct = pickNumber(product, [
      'pixDiscountPercent',
      'descontoPixPercent',
      'descontoPIX',
      'pixPercent',
      'percentPix'
    ], 0);
    if (fromProduct > 0) return clamp(fromProduct, 0, 90);

    const settings = window.__PAYMENT_SETTINGS || window.__paymentsSettings || null;
    const fromSettings = toNumberBR(settings?.pix?.discountPercent, 0);
    if (fromSettings > 0) return clamp(fromSettings, 0, 90);

    return DEFAULT_PIX_PERCENT;
  }

  function computePricing(product) {
    product = product || window.currentProductData || {};

    const rawPrice = pickNumber(product, [
      'price',
      'preco',
      'valor',
      'salePrice',
      'sale_price',
      'fullPrice',
      'prazoPrice'
    ], 0);

    const explicitOldPrice = pickNumber(product, [
      'oldPrice',
      'old_price',
      'precoAntigo',
      'precoDe',
      'precoOriginal',
      'priceOriginal',
      'originalPrice'
    ], 0);

    const explicitPixPrice = pickNumber(product, [
      'pixPrice',
      'precoPix',
      'cashPrice',
      'pricePix',
      'valorPix'
    ], 0);

    const pixPercent = getPixPercent(product);

    // Preço cheio usado no cartão/prazo.
    // Na Ariana esse normalmente é product.price. O PIX fica como preço com desconto.
    let prazoPrice = rawPrice;

    // Se o cadastro tiver pixPrice explícito menor que o price, mantém price como prazo.
    // Se por algum motivo price vier como PIX e oldPrice vier como preço cheio, usa oldPrice como prazo.
    if (explicitPixPrice > 0 && rawPrice > 0 && explicitPixPrice < rawPrice) {
      prazoPrice = rawPrice;
    } else if (explicitOldPrice > rawPrice && rawPrice > 0 && !explicitPixPrice) {
      prazoPrice = rawPrice;
    }

    const pixPrice = explicitPixPrice > 0 && explicitPixPrice < prazoPrice
      ? explicitPixPrice
      : +(prazoPrice * (1 - pixPercent / 100)).toFixed(2);

    const oldPrice = explicitOldPrice > prazoPrice
      ? explicitOldPrice
      : 0;

    const installments = DEFAULT_INSTALLMENTS;
    const installmentValue = prazoPrice > 0 ? +(prazoPrice / installments).toFixed(2) : 0;

    return {
      oldPrice,
      fullPrice: prazoPrice,
      prazoPrice,
      original: prazoPrice,
      pixPrice,
      cash: pixPrice,
      pixPercent,
      discountPercent: pixPercent,
      installments,
      installmentValue,
      oldPriceFormatted: formatCurrency(oldPrice),
      fullPriceFormatted: formatCurrency(prazoPrice),
      pixPriceFormatted: formatCurrency(pixPrice),
      installmentValueFormatted: formatCurrency(installmentValue),
      installmentsText: `ou ${installments}x de ${formatCurrency(installmentValue)} s/ juros no cartão`,
      totalPrazoText: `Total parcelado: ${formatCurrency(prazoPrice)}`
    };
  }

  function applyPricing(product) {
    const pricing = computePricing(product);
    window.__detailPricing = pricing;

    const installmentsEl = document.getElementById('product-price-installments');
    if (installmentsEl) {
      installmentsEl.innerHTML = `
        <span class="block text-gray-800 font-extrabold text-base">${pricing.installmentsText}</span>
        <span class="block text-sm text-gray-500 mt-1">${pricing.totalPrazoText}</span>
      `;
      installmentsEl.style.display = 'block';
    }

    const oldPriceEl = document.getElementById('product-old-price');
    if (oldPriceEl) {
      if (pricing.oldPrice > pricing.fullPrice) {
        oldPriceEl.textContent = pricing.oldPriceFormatted;
        oldPriceEl.style.display = 'block';
        oldPriceEl.classList.add('line-through');
      } else {
        oldPriceEl.style.display = 'none';
      }
    }

    const priceEl = document.getElementById('product-price-full');
    if (priceEl) {
      priceEl.innerHTML = `
        <span class="text-2xl font-normal mr-1">R$</span>
        ${pricing.pixPriceFormatted.replace('R$', '').trim()}
        <span class="inline-flex items-center ml-2 px-2 py-1 rounded-md bg-green-50 text-green-600 text-base font-extrabold align-middle">
          ${Math.round(pricing.pixPercent)}% OFF
        </span>
      `;
    }

    const cashEl = document.getElementById('product-price-cash');
    if (cashEl) {
      cashEl.innerHTML = `<i class="fas fa-bolt mr-1"></i> ${pricing.pixPriceFormatted} no PIX à vista`;
      cashEl.style.display = 'block';
    }

    return pricing;
  }

  window.computeArianaDetailPricing = computePricing;
  window.applyArianaDetailPricing = applyPricing;

  function tryApply() {
    const product = window.currentProductData || window.productData || window.currentProduct || null;
    if (!product) return false;
    applyPricing(product);
    return true;
  }

  document.addEventListener('DOMContentLoaded', () => {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (tryApply() || attempts >= 80) clearInterval(timer);
    }, 150);
  });

  // Garante correção mesmo se o HTML preencher os campos depois do carregamento.
  const observer = new MutationObserver(() => {
    const product = window.currentProductData || null;
    const installmentsEl = document.getElementById('product-price-installments');
    if (!product || !installmentsEl) return;
    if (!/Total parcelado/i.test(installmentsEl.textContent || '') || !/cart[aã]o/i.test(installmentsEl.textContent || '')) {
      applyPricing(product);
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    const target = document.getElementById('product-details-container') || document.body;
    if (target) observer.observe(target, { childList: true, subtree: true, characterData: true });
  });
})();
