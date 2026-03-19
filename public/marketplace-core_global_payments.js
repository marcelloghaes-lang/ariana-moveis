/**
 * ARIANA MÓVEIS - SCRIPT CENTRAL DE MARKETPLACE
 * Este ficheiro gere a lógica de Sellers sem mexer no seu HTML/CSS.
 *
 * ✅ Inclui agora um "bridge" para o Header carregar categorias do Firestore:
 *    - MarketplaceCore.bindFirestore({...})  -> expõe refs no window (db, getDocs, collection, etc.)
 *    - MarketplaceCore.cacheCategories(cats) -> opcional, cache para o header
 */

(function () {
  'use strict';

  const CART_KEY = 'arianaMoveisCart';

  function safeJsonParse(str, fallback) {
    try { return JSON.parse(str); } catch (_) { return fallback; }
  }

  function getCart() {
    return safeJsonParse(localStorage.getItem(CART_KEY), []) || [];
  }

  function setCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart || []));
  }

  function toNumber(val) {
    const n = Number(val);
    return Number.isFinite(n) ? n : 0;
  }

  const MarketplaceCore = {
    /**
     * 🔌 Bridge do Firestore para scripts não-module (ex: header.js)
     *
     * Como usar (no seu init Firebase module):
     * MarketplaceCore.bindFirestore({ db, collection, getDocs, query, where, orderBy, limit });
     */
    bindFirestore: function (refs) {
      try {
        if (!refs || !refs.db) return false;

        // Expor no window para o header
        window.db = refs.db;
        if (refs.collection) window.collection = refs.collection;
        if (refs.getDocs) window.getDocs = refs.getDocs;
        if (refs.query) window.query = refs.query;
        if (refs.where) window.where = refs.where;
        if (refs.orderBy) window.orderBy = refs.orderBy;
        if (refs.limit) window.limit = refs.limit;

        return true;
      } catch (e) {
        console.warn('[MarketplaceCore] bindFirestore falhou:', e);
        return false;
      }
    },

    /**
     * ✅ Cache opcional (fallback) para o header usar sem buscar novamente
     */
    cacheCategories: function (categoriesArray) {
      try {
        if (Array.isArray(categoriesArray)) {
          window.__CATEGORIES_CACHE__ = categoriesArray;
          return true;
        }
      } catch (_) {}
      return false;
    },

    // 1. Guarda o produto com a marca do Seller
    adicionarAoCarrinho: function (produto, sellerId, sellerName) {
      const carrinho = getCart();

      const images = produto?.images || produto?.imagens;
      const firstImage =
        (typeof produto?.mainImage === 'string' && produto.mainImage) ? produto.mainImage :
        (typeof produto?.mainImageUrl === 'string' && produto.mainImageUrl) ? produto.mainImageUrl :
        (typeof produto?.imageUrl === 'string' && produto.imageUrl) ? produto.imageUrl :
        (Array.isArray(images) && images[0])
          ? (typeof images[0] === 'string' ? images[0] : (images[0]?.url || ''))
          : '';

      const novoItem = {
        id: produto?.id,
        name: produto?.name || produto?.nome || 'Produto',
        price: toNumber(produto?.price),
        image: firstImage || '',
        quantity: toNumber(produto?.quantity) || 1,
        // Identificação crucial do Marketplace
        sellerId: sellerId || 'admin',
        sellerName: sellerName || 'Ariana Móveis'
      };

      if (!novoItem.id) {
        console.warn('[MarketplaceCore] Produto sem id. Não foi possível adicionar ao carrinho.');
        alert('Erro: produto inválido (sem ID).');
        return;
      }

      const index = carrinho.findIndex(item => item.id === novoItem.id);
      if (index > -1) {
        carrinho[index].quantity = toNumber(carrinho[index].quantity) + novoItem.quantity;
      } else {
        carrinho.push(novoItem);
      }

      setCart(carrinho);
      console.log(`Sucesso: Produto de ${novoItem.sellerName} adicionado.`);
      alert('Produto adicionado ao carrinho!');
    },

    // 2. Agrupa os itens por Seller para o Checkout
    agruparPorVendedor: function () {
      const carrinho = getCart();

      return carrinho.reduce((grupos, item) => {
        const sId = item?.sellerId || 'admin';
        if (!grupos[sId]) {
          grupos[sId] = {
            nomeVendedor: item?.sellerName || 'Ariana Móveis',
            itens: [],
            total: 0
          };
        }
        const price = toNumber(item?.price);
        const qty = toNumber(item?.quantity) || 1;

        grupos[sId].itens.push({ ...item, price, quantity: qty });
        grupos[sId].total += (price * qty);

        return grupos;
      }, {});
    },

    // 3. Envia pedidos separados para o Firebase
    finalizarPedidoMarketplace: async function (db, dadosCliente, { addDoc, collection, serverTimestamp }) {
      const pedidosAgrupados = this.agruparPorVendedor();
      const promessas = [];

      for (const sellerId in pedidosAgrupados) {
        const grupo = pedidosAgrupados[sellerId];

        const payloadPedido = {
          ...(dadosCliente || {}), // Nome, e-mail, morada, etc.
          sellerId: sellerId,
          sellerName: grupo.nomeVendedor,
          items: grupo.itens,
          totalPrice: toNumber(grupo.total),
          status: 'PENDENTE',
          createdAt: serverTimestamp()
        };

        // Cria um documento de pedido diferente para cada Seller
        promessas.push(addDoc(collection(db, 'orders'), payloadPedido));
      }

      return Promise.all(promessas);
    },

    // Utilitários (opcional)
    getCart: getCart,
    setCart: setCart,
    clearCart: function () {
      setCart([]);
    }
  };

  // Torna o objeto acessível globalmente
  window.MarketplaceCore = MarketplaceCore;

})();

