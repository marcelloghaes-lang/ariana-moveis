// ============================================================
// ENTERPRISE SIGE - PRODUTO SERVICE
// Funções de pesquisa, criação e garantia de produtos no SIGE extraídas
// de routes/enterprise/enterpriseSigeRoutes.js sem alterar regras.
// ============================================================

export function createSigeProdutoService(context = {}) {
  const {
    ensureArray,
    redact,
    arianaSigeMoney,
    arianaSigeFirstValue,
    arianaSigeCleanObjectForPayload,
    sigeRequest
  } = context;

function arianaSigeNormalizeProdutoList(raw = {}) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.Dados)) return raw.Dados;
  if (Array.isArray(raw?.produtos)) return raw.produtos;
  if (Array.isArray(raw?.Produtos)) return raw.Produtos;
  if (raw && typeof raw === 'object' && Object.keys(raw).length) return [raw];
  return [];
}

function arianaSigeNormalizeCode(value = '') {
  return String(value || '').trim().toLowerCase();
}

function arianaSigeProdutoMatches(produto = {}, item = {}) {
  const codigoItem = arianaSigeNormalizeCode(item.Codigo || item.codigo || item.sku || '');
  const nomeItem = String(item.Descricao || item.descricao || item.Nome || item.nome || '').trim().toLowerCase();
  const codigosProduto = [
    produto.Codigo,
    produto.codigo,
    produto.SKU,
    produto.Sku,
    produto.Referencia,
    produto.referencia,
    produto.CodigoProduto,
    produto.codigoProduto,
    produto.CodigoInterno,
    produto.codigoInterno
  ].map(arianaSigeNormalizeCode).filter(Boolean);
  const nomesProduto = [
    produto.Nome,
    produto.nome,
    produto.Descricao,
    produto.descricao,
    produto.NomeProduto,
    produto.nomeProduto
  ].map((v) => String(v || '').trim().toLowerCase()).filter(Boolean);

  if (codigoItem && codigosProduto.includes(codigoItem)) return true;
  if (nomeItem && nomesProduto.includes(nomeItem)) return true;
  return false;
}

function arianaSigeProdutoPayloadFromItem(item = {}, index = 0) {
  const codigo = String(item.Codigo || item.codigo || item.sku || item.productId || `ARIANA-${index + 1}`).trim();
  const nome = String(item.Descricao || item.descricao || item.name || item.Nome || codigo || `Produto Ariana ${index + 1}`).trim();
  const unidade = String(item.Unidade || item.unidade || 'UN').trim() || 'UN';
  const valor = arianaSigeMoney(arianaSigeFirstValue(item.ValorUnitario, item.valorUnitario, item.unitPrice, item.price, 0));
  const grupo = String(process.env.SIGE_PRODUTO_GRUPO || process.env.SIGE_GRUPO_PRODUTO || 'Ariana Marketplace').trim();
  const categoria = String(process.env.SIGE_PRODUTO_CATEGORIA || process.env.SIGE_CATEGORIA || 'Varejo').trim();
  const ncm = String(process.env.SIGE_PRODUTO_NCM || '').replace(/\D/g, '');

  const payload = {
    Codigo: codigo,
    Nome: nome,
    Descricao: nome,
    Unidade: unidade,
    UnidadeCompra: unidade,
    UnidadeVenda: unidade,
    UnidadeComercial: unidade,
    Grupo: grupo,
    Categoria: categoria,
    Marca: String(item.Marca || item.marca || item.brand || 'Ariana Marketplace').trim(),
    PrecoVenda: valor,
    ValorVenda: valor,
    ValorUnitario: valor,
    PrecoCusto: valor,
    EstoqueAtual: Number(process.env.SIGE_PRODUTO_ESTOQUE_PADRAO || 9999),
    Estoque: Number(process.env.SIGE_PRODUTO_ESTOQUE_PADRAO || 9999),
    Ativo: true,
    Produto: true,
    Servico: false
  };

  if (ncm) payload.NCM = ncm;
  return arianaSigeCleanObjectForPayload(payload);
}

async function arianaSigePesquisarProdutoPorItem(item = {}, index = 0) {
  const codigo = String(item.Codigo || item.codigo || item.sku || '').trim();
  const nome = String(item.Descricao || item.descricao || item.name || item.Nome || '').trim();
  const attempts = [];
  if (codigo) attempts.push({ codigo });
  if (codigo) attempts.push({ Codigo: codigo });
  if (nome) attempts.push({ nome });
  if (nome) attempts.push({ Nome: nome });
  attempts.push({ pageSize: 50, skip: 0 });

  for (const params of attempts) {
    try {
      const raw = await sigeRequest('GET', 'Produtos/Pesquisar', { params });
      const list = arianaSigeNormalizeProdutoList(raw);
      const found = list.find((produto) => arianaSigeProdutoMatches(produto, item));
      if (found) return { found: true, produto: found, raw, params };
      if (list.length && codigo) {
        const loose = list.find((produto) => String(produto.Codigo || produto.codigo || '').trim() === codigo);
        if (loose) return { found: true, produto: loose, raw, params };
      }
    } catch (error) {
      // Algumas contas retornam 404/400 quando a pesquisa nÃ£o encontra nada. Nesse caso tentamos criar.
    }
  }

  return { found: false, produto: null, raw: null, params: attempts[0] || {} };
}

async function arianaSigeCriarProdutoPorItem(item = {}, index = 0) {
  const payload = arianaSigeProdutoPayloadFromItem(item, index);
  const endpoints = Array.from(new Set([
    String(process.env.SIGE_PRODUTO_CREATE_ENDPOINT || '').replace(/^\/+/, '').trim(),
    'Produtos/Salvar',
    'Produtos/Criar',
    'Produto/Salvar',
    'Produto/Criar'
  ].filter(Boolean)));

  const errors = [];
  for (const endpoint of endpoints) {
    try {
      const raw = await sigeRequest('POST', endpoint, { data: payload });
      return { action: 'created', endpoint, produto: raw, payload, raw };
    } catch (error) {
      errors.push({ endpoint, statusCode: error.statusCode || null, error: error.message || String(error), response: redact(error.responseData || null), payload: redact(payload) });
    }
  }

  const err = new Error(`NÃ£o foi possÃ­vel cadastrar produto no SIGE antes da venda: ${payload.Codigo || payload.Nome || 'produto sem cÃ³digo'}`);
  err.statusCode = errors[0]?.statusCode || 502;
  err.responseData = { attempted: errors, payloadProduto: redact(payload) };
  throw err;
}

async function arianaSigeEnsureProdutoItem(item = {}, index = 0) {
  const search = await arianaSigePesquisarProdutoPorItem(item, index);
  if (search.found) {
    return { action: 'found', item: redact(item), produto: search.produto, search };
  }

  try {
    const created = await arianaSigeCriarProdutoPorItem(item, index);
    return { ...created, item: redact(item), search };
  } catch (error) {
    error.message = `${error.message || 'Erro ao cadastrar produto no SIGE'} â€” item ${String(item.Codigo || item.Descricao || index + 1)}`;
    throw error;
  }
}

async function arianaSigeEnsureProdutosForVendaPayload(vendaPayload = {}) {
  const items = ensureArray(vendaPayload.Items || vendaPayload.Itens || vendaPayload.items);
  const results = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) continue;
    const result = await arianaSigeEnsureProdutoItem(item, index);
    results.push(result);
  }

  return {
    action: 'ensured',
    total: items.length,
    results
  };
}

  return {
    arianaSigeNormalizeProdutoList,
    arianaSigeNormalizeCode,
    arianaSigeProdutoMatches,
    arianaSigeProdutoPayloadFromItem,
    arianaSigePesquisarProdutoPorItem,
    arianaSigeCriarProdutoPorItem,
    arianaSigeEnsureProdutoItem,
    arianaSigeEnsureProdutosForVendaPayload
  };
}
