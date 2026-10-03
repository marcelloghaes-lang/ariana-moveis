import express from 'express';

function escapeRegex(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function collectSellerKeys(req = {}) {
  const keys = new Set();
  const seller = req.seller || {};
  const user = req.user || {};
  [
    req.sellerId,
    seller.sellerId,
    seller._id,
    seller.id,
    user.sellerId
  ].forEach((value) => {
    const clean = String(value || '').trim();
    if (clean) keys.add(clean);
  });
  return Array.from(keys);
}

function collectSellerNames(req = {}) {
  const seller = req.seller || {};
  const user = req.user || {};
  return [
    seller.storeName,
    seller.displayName,
    seller.name,
    seller.email,
    user.name,
    user.email
  ].map((value) => String(value || '').trim()).filter(Boolean);
}

function sellerProductFilter(req = {}) {
  const sellerKeys = collectSellerKeys(req);
  const or = [];
  if (sellerKeys.length) {
    or.push({ sellerId: { $in: sellerKeys } });
    or.push({ seller_id: { $in: sellerKeys } });
    or.push({ vendorId: { $in: sellerKeys } });
    or.push({ manufacturer: { $in: sellerKeys } });
  }
  if (!or.length) return { _id: null };
  return { $or: or };
}

async function findSellerProducts(Product, req, query = {}) {
  const limit = Math.min(Number(query.limit || 500), 1000);
  const sortBy = String(query.sortBy || 'updatedAt');
  const sortDir = String(query.sortDir || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  const search = String(query.q || query.search || '').trim();
  const baseFilter = sellerProductFilter(req);
  const and = [baseFilter];
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    and.push({ $or: [{ name: rx }, { sku: rx }, { category: rx }, { categoryName: rx }, { brand: rx }] });
  }
  let rows = await Product.find(and.length > 1 ? { $and: and } : baseFilter).sort({ [sortBy]: sortDir }).limit(limit);

  // Fallback controlado para produtos antigos cadastrados sem sellerId,
  // usando o nome/loja/e-mail do seller. Evita tela vazia quando o dado legado existe.
  if (!rows.length) {
    const names = collectSellerNames(req);
    const nameOr = names.map((name) => {
      const rx = new RegExp(`^${escapeRegex(name)}$`, 'i');
      return { $or: [{ sellerName: rx }, { storeName: rx }, { vendorName: rx }, { manufacturer: rx }] };
    });
    if (nameOr.length) {
      rows = await Product.find({ $or: nameOr }).sort({ [sortBy]: sortDir }).limit(limit);
    }
  }
  return rows;
}

function publicSellerFilter(sellerId = '') {
  const id = String(sellerId || '').trim();
  if (!id) return { _id: null };
  const rx = new RegExp(`^${escapeRegex(id)}$`, 'i');
  return {
    active: { $ne: false },
    $or: [
      { sellerId: id },
      { seller_id: id },
      { vendorId: id },
      { manufacturer: id },
      { sellerName: rx },
      { storeName: rx },
      { vendorName: rx }
    ]
  };
}

// ============================================================
// PROTEÇÃO DE IMAGENS DO PRODUTO SELLER
// Garante que os links retornados pelo Cloudinary não sejam perdidos
// entre o frontend, productPayloadFromBody e o MongoDB.
// ============================================================
function forceProductImages(payload = {}, body = {}) {
  const images = asArray(body.images || payload.images)
    .map((img, index) => {
      if (!img) return null;

      if (typeof img === 'string') {
        const url = String(img || '').trim();
        if (!url) return null;
        return {
          url,
          path: url,
          name: `imagem_${index + 1}`,
          isMain: index === 0
        };
      }

      const url = String(img.url || img.imageUrl || img.secure_url || img.secureUrl || img.downloadURL || img.downloadUrl || img.image || '').trim();
      if (!url) return null;

      return {
        ...img,
        url,
        path: String(img.path || img.public_id || img.publicId || img.fullPath || img.filePath || url).trim(),
        name: String(img.name || img.originalname || `imagem_${index + 1}`).trim(),
        isMain: img.isMain === true || img.main === true || index === 0,
        public_id: String(img.public_id || img.publicId || '').trim(),
        contentType: String(img.contentType || img.mimetype || '').trim() || undefined
      };
    })
    .filter(Boolean);

  const flatUrls = asArray(body.imageUrls || payload.imageUrls)
    .map((url) => String(url || '').trim())
    .filter(Boolean);

  const flatPaths = asArray(body.imagePaths || payload.imagePaths)
    .map((pathValue) => String(pathValue || '').trim());

  flatUrls.forEach((url, index) => {
    if (!images.some((img) => img.url === url)) {
      images.push({
        url,
        path: flatPaths[index] || url,
        name: `imagem_${images.length + 1}`,
        isMain: images.length === 0
      });
    }
  });

  const directMainUrl = String(
    body.mainImageUrl ||
    body.imageUrl ||
    body.image ||
    body.imagem ||
    body.thumbnail ||
    payload.mainImageUrl ||
    payload.imageUrl ||
    payload.image ||
    payload.imagem ||
    payload.thumbnail ||
    ''
  ).trim();

  if (directMainUrl && !images.some((img) => img.url === directMainUrl || img.path === directMainUrl)) {
    images.unshift({
      url: directMainUrl,
      path: String(body.mainImagePath || payload.mainImagePath || directMainUrl).trim(),
      name: 'principal',
      isMain: true
    });
  }

  if (images.length && !images.some((img) => img.isMain)) {
    images[0].isMain = true;
  }

  const main = images.find((img) => img.isMain) || images[0] || null;
  const mainUrl = main?.url || directMainUrl || '';
  const mainPath = main?.path || String(body.mainImagePath || payload.mainImagePath || mainUrl || '').trim();

  payload.images = images;
  payload.imageUrls = images.map((img) => img.url).filter(Boolean);
  payload.imagePaths = images.map((img) => img.path || img.url).filter(Boolean);
  payload.image = mainUrl;
  payload.imageUrl = mainUrl;
  payload.imagem = mainUrl;
  payload.mainImageUrl = mainUrl;
  payload.mainImagePath = mainPath;
  payload.thumbnail = mainUrl;

  return payload;
}


// ============================================================
// IMPORTAÇÃO INDUSTRIAL DE CATÁLOGOS DE FORNECEDORES
// Camada genérica: CSV/Excel/XML/API podem ser convertidos para rows.
// Esta rota não busca URLs externas nem publica automaticamente:
// produtos novos entram em revisão para evitar preço/estoque/fiscal incorretos.
// ============================================================
function catalogKey(value=''){
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
}
function catalogNumber(value, fallback=0){
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  let s=String(value ?? '').trim().replace(/R\$/gi,'').replace(/\s/g,'');
  if (!s) return fallback;
  if (s.includes(',')) s=s.replace(/\./g,'').replace(',', '.');
  const n=Number(s.replace(/[^0-9.-]/g,''));
  return Number.isFinite(n)?n:fallback;
}
function catalogValue(row={}, aliases=[]){
  const mapped={};
  for(const [k,v] of Object.entries(row||{})) mapped[catalogKey(k)]=v;
  for(const alias of aliases){
    const key=catalogKey(alias);
    if(mapped[key]!==undefined && mapped[key]!==null && String(mapped[key]).trim()!=='') return mapped[key];
  }
  return '';
}
function catalogImages(value){
  if(Array.isArray(value)) return value.map(v=>String(v?.url||v||'').trim()).filter(Boolean).slice(0,12);
  return String(value||'').split(/[|;\n]/).map(v=>v.trim()).filter(v=>/^https?:\/\//i.test(v)).slice(0,12);
}

const MANAGED_CATALOG_MODES=new Set(['sale_order','dropshipping','cross_docking']);
const CATALOG_PRICE_FACTOR=0.70;

// Referência conservadora para exibir a MVA do cadastro fiscal. MVA NÃO é a
// alíquota efetiva de ST e, sozinha, não autoriza cálculo tributário.
const MG_ST_MVA_REFERENCE=[
  {match:['73211100','73218100','73219000'],cests:['2100100'],mva:50},
  {match:['84181000'],cests:['2100200'],mva:40},
  {match:['84182100'],cests:['2100300'],mva:40},
  {match:['84182900'],cests:['2100400'],mva:40},
  {match:['84183000'],cests:['2100500'],mva:40},
  {match:['84184000'],cests:['2100600'],mva:45},
  {prefix:['845020'],cests:['2102200'],mva:45},
  {match:['84501100'],cests:['2101900'],mva:45},
  {match:['84501200'],cests:['2102000'],mva:45},
  {match:['84501900'],cests:['2102100'],mva:45},
  {match:['85171300'],cests:['2105300','2105301'],mva:18.34},
  {prefix:['8517143'],cests:['2105300','2105301'],mva:18.34}
];
function roundCatalogMoney(v=0){return Math.round((Number(v||0)+Number.EPSILON)*100)/100}
function normalizeCatalogMode(value=''){
  const raw=catalogKey(value);
  if(['saleorder','vendaordem','vendaaordem'].includes(raw)) return 'sale_order';
  if(['crossdocking','crossdock','cross'].includes(raw)) return 'cross_docking';
  if(['dropshipping','drop'].includes(raw)) return 'dropshipping';
  return 'marketplace_pure';
}

function sellerCatalogPolicy(req={}){
  const meta=req.seller?.metadata&&typeof req.seller.metadata==='object'?req.seller.metadata:{};
  const fiscalRaw=String(meta.fiscalOperationModel||req.seller?.fiscalOperationModel||'marketplace_intermediation').trim().toLowerCase();
  const operationMode=fiscalRaw==='sale_order'?'sale_order':'marketplace_pure';

  // A política comercial/fiscal da Ariana não é escolhida pelo seller na tela.
  // Seller marketplace envia seu preço-base normalmente; venda à ordem entra em
  // revisão fiscal conservadora até o ST aplicável estar confirmado.
  const taxMode=operationMode==='sale_order'?'possible_extra':'included_confirmed';
  return {operationMode,taxMode};
}
function mgMvaReference(ncm='',cest=''){
  const code=String(ncm||'').replace(/\D/g,'').slice(0,8);
  const c=String(cest||'').replace(/\D/g,'').slice(0,7);
  for(const rule of MG_ST_MVA_REFERENCE){
    const ok=(rule.match||[]).includes(code)||(rule.prefix||[]).some(p=>code.startsWith(p));
    if(!ok) continue;
    return {mva:rule.mva,cestCompatible:!c||(rule.cests||[]).includes(c),officialCests:rule.cests||[]};
  }
  return null;
}
function managedCatalogPricing(item={}, options={}){
  const operationMode=normalizeCatalogMode(options.operationMode||'');
  const managed=MANAGED_CATALOG_MODES.has(operationMode);
  const supplierPrice=roundCatalogMoney(item.price||0);
  const legacyTaxesIncluded=options.taxesIncluded===true || String(options.taxesIncluded).toLowerCase()==='true';
  const requestedTaxMode=String(options.taxMode||'').trim().toLowerCase();
  const taxMode=['included_confirmed','possible_extra','extra_not_included'].includes(requestedTaxMode)
    ? requestedTaxMode
    : (legacyTaxesIncluded?'included_confirmed':'extra_not_included');
  const taxesIncluded=taxMode!=='extra_not_included';
  const explicitStAmount=Math.max(0,roundCatalogMoney(item.stAmountInput||0));
  const explicitStPercent=Math.max(0,Number(item.stPercentInput||0)||0);
  let stAmount=0,stEffectivePercent=0,stStatus='not_applicable';
  if(managed){
    if(explicitStAmount>0){
      stAmount=explicitStAmount;
      stEffectivePercent=supplierPrice>0?roundCatalogMoney((stAmount/supplierPrice)*100):0;
      stStatus='supplier_amount';
    }else if(explicitStPercent>0){
      stEffectivePercent=roundCatalogMoney(explicitStPercent);
      stAmount=roundCatalogMoney(supplierPrice*(stEffectivePercent/100));
      stStatus='supplier_percent';
    }else if(taxMode==='included_confirmed'){
      stStatus='included_in_supplier_price';
    }else if(taxMode==='possible_extra'){
      stStatus='possible_extra_st_review';
    }else{
      stStatus='review_required';
    }
  }
  const supplierPayable=roundCatalogMoney(supplierPrice+stAmount);
  const finalCashPrice=managed ? roundCatalogMoney(supplierPayable/CATALOG_PRICE_FACTOR) : supplierPrice;
  const grossMarginValue=managed?roundCatalogMoney(finalCashPrice-supplierPayable):0;
  const grossMarginPercent=managed&&finalCashPrice>0?roundCatalogMoney((grossMarginValue/finalCashPrice)*100):0;
  const mvaRef=mgMvaReference(item.ncm,item.cest);
  return {
    operationMode,managed,supplierPrice,taxMode,taxesIncluded,stAmount,stEffectivePercent,stStatus,
    mvaReferencePercent:mvaRef?.mva??null,
    mvaCestCompatible:mvaRef?.cestCompatible??null,
    officialCests:mvaRef?.officialCests||[],
    priceFactor:CATALOG_PRICE_FACTOR,supplierPayable,finalCashPrice,grossMarginValue,grossMarginPercent,
    pricingPendingTaxReview:managed&&['review_required','possible_extra_st_review'].includes(stStatus)
  };
}

function prepareCatalogRows(rows=[],source='catalog'){
  const isDropDeCasa=catalogKey(source).includes('dropdecasa');
  if(!isDropDeCasa) return rows;
  let base=null;
  return rows.map((original)=>{
    const row={...(original||{})};
    const sku=String(catalogValue(row,['sku','codigo','código','referencia','referência'])||'').trim();
    const name=String(catalogValue(row,['name','nome','produto','titulo','title'])||'').trim();
    if(!sku&&!name) return row;

    const price=catalogNumber(catalogValue(row,['price','preco','preço','valor']),0);
    if(price>0){
      base={...row};
      return row;
    }
    if(!base) return row;

    const inheritAliases=[
      ['VALOR',['price','preco','preço','valor']],
      ['FORNECEDOR',['supplier','fornecedor','seller','distribuidor']],
      ['CATEGORIA',['category','categoria','departamento']],
      ['MÉTODOS DE ENVIO',['metodos de envio','métodos de envio','formas de envio','shipping methods']],
      ['DIMENSÃO EMBALAGEM)',['dimensao embalagem','dimensão embalagem','dimensao embalagem)','dimensão embalagem)','embalagem']],
      ['PESO (kg)',['weight','peso','peso kg','pesokg']],
      ['DESCRITIVO TÉCNICO',['description','descricao','descrição','descritivo tecnico','descritivo técnico']]
    ];
    for(const [target,aliases] of inheritAliases){
      if(String(catalogValue(row,aliases)||'').trim()===''){
        const v=catalogValue(base,aliases);
        if(v!==undefined&&v!==null&&String(v).trim()!=='') row[target]=v;
      }
    }
    row.__inheritedVariantFrom=String(catalogValue(base,['sku','codigo','código','referencia','referência'])||'').trim();
    return row;
  });
}

function normalizeCatalogRow(row={}, index=0, source='catalog'){
  const name=String(catalogValue(row,['name','nome','produto','titulo','title','descricao curta'])||'').trim();
  const sku=String(catalogValue(row,['sku','codigo','código','codigo produto','referencia','referência','ref'])||'').trim();
  const ean=String(catalogValue(row,['ean','gtin','codigo barras','código de barras','barcode'])||'').replace(/\D/g,'').trim();
  const supplierProductId=String(catalogValue(row,['supplierProductId','id fornecedor','id produto','product id','id'])||'').trim();
  const stableKey=sku||ean||supplierProductId;
  const price=catalogNumber(catalogValue(row,['price','preco','preço','preco venda','preço venda','preco lojista','preço lojista','valor']),0);
  const stock=Math.max(0,Math.trunc(catalogNumber(catalogValue(row,['stock','estoque','saldo','quantidade','qty']),0)));
  const category=String(catalogValue(row,['category','categoria','departamento'])||'Outros').trim();
  const supplierName=String(catalogValue(row,['supplier','fornecedor','seller','distribuidor'])||'').trim();
  const brand=String(catalogValue(row,['brand','marca','fabricante'])||'').trim();
  const shippingMethods=String(catalogValue(row,['metodos de envio','métodos de envio','formas de envio','shipping methods'])||'').trim();
  const packagingDimension=String(catalogValue(row,['dimensao embalagem','dimensão embalagem','dimensao embalagem)','dimensão embalagem)','embalagem'])||'').trim();
  const description=String(catalogValue(row,['description','descricao','descrição','descricao completa','descrição completa','descritivo tecnico','descritivo técnico'])||name).trim();
  const ncm=String(catalogValue(row,['ncm'])||'').replace(/\D/g,'').trim();
  const cest=String(catalogValue(row,['cest'])||'').replace(/\D/g,'').trim();
  const stAmountInput=catalogNumber(catalogValue(row,['icms st','icmsst','valor st','valor icms st','st amount','st valor']),0);
  const stPercentInput=catalogNumber(catalogValue(row,['st percent','st percentual','percentual st','aliquota st','alíquota st','icms st percent']),0);
  const weight=Math.max(0,catalogNumber(catalogValue(row,['weight','peso','peso kg','pesokg']),0));
  const height=Math.max(0,catalogNumber(catalogValue(row,['height','altura','altura cm','alturacm']),0));
  const width=Math.max(0,catalogNumber(catalogValue(row,['width','largura','largura cm','larguracm']),0));
  const length=Math.max(0,catalogNumber(catalogValue(row,['length','comprimento','profundidade','comprimento cm']),0));
  const imageList=catalogImages(catalogValue(row,['images','imagens','image urls','fotos','foto','image','imagem','url imagem']));
  const errors=[];
  if(!name) errors.push('Nome ausente');
  if(!stableKey) errors.push('SKU/EAN/ID do fornecedor ausente');
  if(!(price>0)) errors.push('Preço inválido');
  const inheritedVariantFrom=String(row.__inheritedVariantFrom||'').trim();
  return {
    index,name,sku,ean,supplierProductId,stableKey,price,stock,category,supplierName,brand,shippingMethods,packagingDimension,description,ncm,cest,inheritedVariantFrom,
    stAmountInput,stPercentInput,weight,height,width,length,imageList,source:String(source||'catalog').trim().slice(0,80),errors
  };
}

export default function createSellerProductRoutes(deps = {}) {
  const router = express.Router();
  const {
    Product,
    sellerAuthRequired,
    toJSON = (doc) => doc,
    normalizeObjectId = () => null,
    normalizeProductForResponse = (doc) => toJSON(doc),
    productPayloadFromBody = (body) => body,
    uid = (prefix = 'id') => `${prefix}_${Date.now()}`,
    now = () => new Date()
  } = deps;

  if (!Product) throw new Error('Product não informado em sellerProductRoutes');
  if (!sellerAuthRequired) throw new Error('sellerAuthRequired não informado em sellerProductRoutes');

  router.get('/seller/products', sellerAuthRequired, async (req, res) => {
    try {
      const rows = await findSellerProducts(Product, req, req.query || {});
      return res.json(rows.map(normalizeProductForResponse));
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar produtos do seller' });
    }
  });

  router.post('/seller/products', sellerAuthRequired, async (req, res) => {
    try {
      const payload = forceProductImages(
        productPayloadFromBody(req.body || {}),
        req.body || {}
      );

      payload.sellerId = String(req.sellerId || '').trim();
      payload.sellerName = String(req.seller?.storeName || req.seller?.displayName || req.user?.name || payload.sellerName || '').trim();
      payload.sku = payload.sku || uid('sku');
      payload.updatedAt = now();

      if (!payload.name) return res.status(400).json({ ok: false, error: 'Nome do produto é obrigatório' });

      const product = await Product.create(payload);
      return res.json({ ok: true, product: normalizeProductForResponse(product) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao cadastrar produto do seller' });
    }
  });

  router.get('/seller/products/:id', sellerAuthRequired, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const oid = normalizeObjectId(id);
      const accessFilter = sellerProductFilter(req);
      const product = await Product.findOne({
        $and: [
          oid ? { $or: [{ _id: oid }, { id }, { sku: id }] } : { $or: [{ id }, { sku: id }, { slug: id }] },
          accessFilter
        ]
      });
      if (!product) return res.status(404).json({ ok: false, error: 'Produto não encontrado para este seller' });
      return res.json({ ok: true, product: normalizeProductForResponse(product) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao carregar produto do seller' });
    }
  });

  router.put('/seller/products/:id', sellerAuthRequired, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const oid = normalizeObjectId(id);
      const accessFilter = sellerProductFilter(req);
      const existing = await Product.findOne({
        $and: [
          oid ? { $or: [{ _id: oid }, { id }, { sku: id }] } : { $or: [{ id }, { sku: id }, { slug: id }] },
          accessFilter
        ]
      });
      if (!existing) return res.status(404).json({ ok: false, error: 'Produto não encontrado para este seller' });

      const payload = forceProductImages(
        productPayloadFromBody(req.body || {}, existing),
        req.body || {}
      );

      payload.sellerId = existing.sellerId || String(req.sellerId || '').trim();
      payload.sellerName = existing.sellerName || String(req.seller?.storeName || req.seller?.displayName || req.user?.name || '').trim();
      payload.updatedAt = now();

      Object.assign(existing, payload);
      await existing.save();
      return res.json({ ok: true, product: normalizeProductForResponse(existing) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao atualizar produto do seller' });
    }
  });

  router.patch('/seller/products/:id', sellerAuthRequired, async (req, res) => {
    req.method = 'PUT';
    return router.handle(req, res);
  });

  router.delete('/seller/products/:id', sellerAuthRequired, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const oid = normalizeObjectId(id);
      const accessFilter = sellerProductFilter(req);
      const product = await Product.findOne({
        $and: [
          oid ? { $or: [{ _id: oid }, { id }, { sku: id }] } : { $or: [{ id }, { sku: id }, { slug: id }] },
          accessFilter
        ]
      });
      if (!product) return res.status(404).json({ ok: false, error: 'Produto não encontrado para este seller' });
      await product.deleteOne();
      return res.json({ ok: true, deleted: true, id });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao excluir produto do seller' });
    }
  });


  router.post('/seller/catalog-import/preview', sellerAuthRequired, async (req, res) => {
    try {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 1000) : [];
      if (!rows.length) return res.status(400).json({ ok:false, error:'Envie pelo menos uma linha do catálogo.' });
      const source=String(req.body?.source||'catalogo_fornecedor').trim().slice(0,80);
      const {operationMode,taxMode}=sellerCatalogPolicy(req);
      const taxesIncluded=taxMode==='included_confirmed';
      const preparedRows=prepareCatalogRows(rows,source);
      const normalized=preparedRows.map((row,index)=>normalizeCatalogRow(row,index,source));
      const valid=normalized.filter(x=>!x.errors.length);
      const skus=[...new Set(valid.map(x=>x.sku).filter(Boolean))];
      const eans=[...new Set(valid.map(x=>x.ean).filter(Boolean))];
      const supplierIds=[...new Set(valid.map(x=>x.supplierProductId).filter(Boolean))];
      const matchOr=[];
      if(skus.length) matchOr.push({sku:{$in:skus}});
      if(eans.length) matchOr.push({'specs.ean':{$in:eans}});
      if(supplierIds.length) matchOr.push({'dropshipping.supplierProductId':{$in:supplierIds}});
      const existing=matchOr.length ? await Product.find({sellerId:String(req.sellerId||''),$or:matchOr}).select('_id sku specs.ean dropshipping.supplierProductId active').lean() : [];
      const existingKeys=new Set();
      existing.forEach(p=>{
        if(p.sku) existingKeys.add('sku:'+String(p.sku));
        if(p.specs?.ean) existingKeys.add('ean:'+String(p.specs.ean));
        if(p.dropshipping?.supplierProductId) existingKeys.add('supplier:'+String(p.dropshipping.supplierProductId));
      });
      const items=normalized.map(item=>{
        const exists=(item.sku&&existingKeys.has('sku:'+item.sku))||(item.ean&&existingKeys.has('ean:'+item.ean))||(item.supplierProductId&&existingKeys.has('supplier:'+item.supplierProductId));
        const pricing=managedCatalogPricing(item,{operationMode,taxMode,taxesIncluded});
        const errors=[...(item.errors||[])];
        if(pricing.managed&&pricing.pricingPendingTaxReview) errors.push('ST extra não confirmado: revisar antes de publicar.');
        return {...item,pricing,errors,action:item.errors.length?'invalid':(exists?'update':'create')};
      });
      return res.json({
        ok:true,total:items.length,
        valid:items.filter(x=>x.action!=='invalid').length,
        invalid:items.filter(x=>x.action==='invalid').length,
        create:items.filter(x=>x.action==='create').length,
        update:items.filter(x=>x.action==='update').length,
        operationMode,taxMode,taxesIncluded,priceFactor:CATALOG_PRICE_FACTOR,items
      });
    } catch(error){
      return res.status(500).json({ok:false,error:error.message||'Erro ao pré-validar catálogo.'});
    }
  });

  router.post('/seller/catalog-import/commit', sellerAuthRequired, async (req, res) => {
    try {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 1000) : [];
      if (!rows.length) return res.status(400).json({ok:false,error:'Envie pelo menos uma linha do catálogo.'});
      const source=String(req.body?.source||'catalogo_fornecedor').trim().slice(0,80);
      const {operationMode,taxMode}=sellerCatalogPolicy(req);
      const taxesIncluded=taxMode==='included_confirmed';
      const sellerId=String(req.sellerId||'').trim();
      const sellerName=String(req.seller?.storeName||req.seller?.displayName||req.user?.name||'').trim();
      const preparedRows=prepareCatalogRows(rows,source);
      const normalized=preparedRows.map((row,index)=>normalizeCatalogRow(row,index,source)).filter(x=>!x.errors.length);
      const ops=[];
      const stamp=now();
      for(const item of normalized){
        const pricing=managedCatalogPricing(item,{operationMode,taxMode,taxesIncluded});
        const filter=item.sku?{sellerId,sku:item.sku}:item.ean?{sellerId,'specs.ean':item.ean}:{sellerId,'dropshipping.supplierProductId':item.supplierProductId};
        const image=item.imageList[0]||'';
        const set={
          sellerId,sellerName,name:item.name,description:item.description,category:item.category,categoryName:item.category,
          brand:item.brand,price:pricing.finalCashPrice,pixPrice:pricing.finalCashPrice,stock:item.stock,updatedAt:stamp,
          'dropshipping.enabled':pricing.managed,
          'dropshipping.mode':pricing.operationMode,
          'dropshipping.supplierPrice':pricing.supplierPrice,
          'dropshipping.supplierPayableUnit':pricing.supplierPayable,
          'dropshipping.pricing.priceFactor':pricing.priceFactor,
          'dropshipping.pricing.finalCashPrice':pricing.finalCashPrice,
          'dropshipping.pricing.grossMarginValue':pricing.grossMarginValue,
          'dropshipping.pricing.grossMarginPercent':pricing.grossMarginPercent,
          'dropshipping.pricing.taxMode':pricing.taxMode,
          'dropshipping.pricing.taxesIncluded':pricing.taxesIncluded,
          'dropshipping.pricing.stAmount':pricing.stAmount,
          'dropshipping.pricing.stEffectivePercent':pricing.stEffectivePercent,
          'dropshipping.pricing.stStatus':pricing.stStatus,
          'dropshipping.pricing.mvaReferencePercent':pricing.mvaReferencePercent,
          'dropshipping.pricing.pricingPendingTaxReview':pricing.pricingPendingTaxReview,
          'dropshipping.catalogSource':item.source,
          'dropshipping.supplierName':item.supplierName,
          'dropshipping.supplierSku':item.sku,
          'dropshipping.supplierProductId':item.supplierProductId,
          'dropshipping.lastCatalogSyncAt':stamp,
          'dropshipping.shippingMethodsRaw':item.shippingMethods,
          'dropshipping.packagingDimensionRaw':item.packagingDimension,
          'dropshipping.variantInheritedFromSku':item.inheritedVariantFrom,
          'specs.ean':item.ean,
          'specs.ncm':item.ncm,
          'specs.cest':item.cest,
          'specs.catalogImport.source':item.source,
          'specs.catalogImport.lastSyncAt':stamp,
          'specs.catalogImport.status':'staged'
        };
        if(item.sku) set.sku=item.sku;
        if(item.weight) set.weight=item.weight;
        if(item.height) set.height=item.height;
        if(item.width) set.width=item.width;
        if(item.length) set.length=item.length;
        if(image){
          set.image=image;set.imageUrl=image;set.imagem=image;set.mainImageUrl=image;
          set.imageUrls=item.imageList;set.images=item.imageList.map((url,i)=>({url,path:url,isMain:i===0,name:'catalogo_'+(i+1)}));
        }
        const setOnInsert={
          active:false,
          storefrontStatus:'pending',
          storefrontSource:'supplier_catalog_import',
          storefrontSubmittedAt:stamp
        };
        if(pricing.pricingPendingTaxReview){
          set.active=false;
          set.storefrontStatus='pending_tax_review';
          set['specs.catalogImport.status']='pending_tax_review';
          delete setOnInsert.active;
          delete setOnInsert.storefrontStatus;
        }
        ops.push({updateOne:{filter,update:{
          $set:set,
          $setOnInsert:setOnInsert
        },upsert:true}});
      }
      if(!ops.length) return res.status(400).json({ok:false,error:'Nenhuma linha válida para importar.'});
      const result=await Product.bulkWrite(ops,{ordered:false});
      return res.json({
        ok:true,
        processed:ops.length,
        created:Number(result.upsertedCount||0),
        matched:Number(result.matchedCount||0),
        modified:Number(result.modifiedCount||0),
        skipped:rows.length-ops.length,
        staged:true,
        message:'Catálogo importado em modo de revisão. Operações próprias usam (custo/valor devido ao fornecedor + ST extra confirmado) dividido por 0,70. Produtos novos não foram publicados automaticamente.'
      });
    } catch(error){
      return res.status(500).json({ok:false,error:error.message||'Erro ao importar catálogo.'});
    }
  });

  router.get('/seller/:sellerId/products', async (req, res) => {
    try {
      const rows = await Product.find(publicSellerFilter(req.params.sellerId)).sort({ updatedAt: -1 }).limit(Math.min(Number(req.query.limit || 500), 1000));
      return res.json(rows.map(normalizeProductForResponse));
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar produtos públicos do seller' });
    }
  });

  router.get('/sellers/:sellerId/products', async (req, res) => {
    try {
      const rows = await Product.find(publicSellerFilter(req.params.sellerId)).sort({ updatedAt: -1 }).limit(Math.min(Number(req.query.limit || 500), 1000));
      return res.json(rows.map(normalizeProductForResponse));
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Erro ao listar produtos públicos do seller' });
    }
  });

  return router;
}
