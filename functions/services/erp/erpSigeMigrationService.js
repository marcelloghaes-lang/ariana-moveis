import mongoose from 'mongoose';
import zlib from 'zlib';

const MAX_ZIP_BYTES = 16 * 1024 * 1024;
const MAX_CSV_UNCOMPRESSED = 32 * 1024 * 1024;
const MAX_TOTAL_CSV_UNCOMPRESSED = 64 * 1024 * 1024;

const clean = (value = '', max = 1000) => String(value ?? '').trim().slice(0, max);
const digits = (value = '') => String(value ?? '').replace(/\D/g, '');
const normalize = (value = '') => clean(value, 500)
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();
const normalizeCode = (value = '') => normalize(value).replace(/\s+/g, '');
const normalizeEmail = (value = '') => clean(value, 320).toLowerCase();
const truthy = (value) => ['1', 'true', 'sim', 'yes'].includes(String(value ?? '').trim().toLowerCase());
const numberValue = (value = 0) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value ?? '').trim();
  if (!text) return 0;
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};
const money = (value = 0) => Math.round((numberValue(value) + Number.EPSILON) * 100) / 100;

function fail(message, statusCode = 400, code = 'ERP_SIGE_MIGRATION_ERROR') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

const FILE_ALIASES = {
  people: ['clientes_fornecedores.csv', 'pessoas.csv'],
  products: ['produtos.csv'],
  entries: ['contas_pagar_receber.csv', 'contas_receber.csv', 'contas_pagar.csv'],
  payments: ['pagamentos_baixas.csv', 'pagamentos.csv'],
  categories: ['plano_contas.csv'],
  banks: ['contas_bancarias.csv'],
  sales: ['vendas_pedidos.csv', 'vendas.csv'],
  saleItems: ['itens_vendas.csv', 'itens_venda.csv'],
  nfe: ['nfe.csv'],
  nfeItems: ['nfe_itens.csv', 'itens_nfe.csv'],
  taxGroups: ['grupos_tributarios.csv'],
  fiscalOperations: ['operacoes_fiscais.csv'],
  company: ['empresa.csv'],
  fiscalConfig: ['configuracao_fiscal_sem_segredos.csv']
};

function baseName(path = '') {
  return String(path).replace(/\\/g, '/').split('/').filter(Boolean).pop()?.toLowerCase() || '';
}

function findEocd(buffer) {
  const min = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

export function extractCsvFilesFromZip(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw fail('Pacote ZIP vazio ou inválido.');
  if (buffer.length > MAX_ZIP_BYTES) throw fail('O pacote SIGE excede o limite seguro de 16 MB.', 413, 'SIGE_ZIP_TOO_LARGE');
  const eocd = findEocd(buffer);
  if (eocd < 0) throw fail('Arquivo ZIP inválido: diretório central não encontrado.', 400, 'SIGE_ZIP_INVALID');
  const entriesCount = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (centralOffset + centralSize > buffer.length) throw fail('Arquivo ZIP truncado.', 400, 'SIGE_ZIP_TRUNCATED');
  const files = new Map();
  let offset = centralOffset;
  let totalCsv = 0;
  for (let index = 0; index < entriesCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw fail('Arquivo ZIP inválido: entrada do diretório central corrompida.', 400, 'SIGE_ZIP_INVALID_ENTRY');
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buffer.length) throw fail('Arquivo ZIP inválido: nome de entrada truncado.');
    const fileName = buffer.subarray(nameStart, nameEnd).toString('utf8');
    offset = nameEnd + extraLength + commentLength;
    if (!fileName.toLowerCase().endsWith('.csv')) continue;
    if (flags & 0x0001) throw fail('ZIP protegido por senha não é aceito.', 400, 'SIGE_ZIP_ENCRYPTED');
    if (![0, 8].includes(method)) throw fail(`Método de compactação não suportado no arquivo ${baseName(fileName)}.`);
    if (uncompressedSize > MAX_CSV_UNCOMPRESSED) throw fail(`CSV ${baseName(fileName)} excede o limite seguro.`, 413, 'SIGE_CSV_TOO_LARGE');
    totalCsv += uncompressedSize;
    if (totalCsv > MAX_TOTAL_CSV_UNCOMPRESSED) throw fail('Os CSVs do pacote excedem o limite seguro de 64 MB.', 413, 'SIGE_DATASET_TOO_LARGE');
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw fail(`Cabeçalho local inválido para ${baseName(fileName)}.`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw fail(`Dados truncados em ${baseName(fileName)}.`);
    const compressed = buffer.subarray(dataStart, dataEnd);
    const content = method === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed, { maxOutputLength: MAX_CSV_UNCOMPRESSED });
    if (uncompressedSize && content.length !== uncompressedSize) throw fail(`Tamanho inválido após descompactar ${baseName(fileName)}.`);
    files.set(baseName(fileName), content);
  }
  if (!files.size) throw fail('Nenhum CSV do SIGE foi encontrado dentro do ZIP.', 400, 'SIGE_NO_CSV');
  return files;
}

function detectDelimiter(text = '') {
  let inQuotes = false, semicolon = 0, comma = 0;
  for (let i = 0; i < Math.min(text.length, 10000); i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') i += 1;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && (ch === '\n' || ch === '\r')) break;
    else if (!inQuotes && ch === ';') semicolon += 1;
    else if (!inQuotes && ch === ',') comma += 1;
  }
  return semicolon >= comma ? ';' : ',';
}

export function parseCsvBuffer(buffer) {
  let text = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer ?? '');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n') {
      row.push(field.replace(/\r$/, '')); field = '';
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''));
    if (row.some((value) => value !== '')) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift().map((header) => clean(header, 200));
  return rows.map((values) => {
    const out = {};
    for (let i = 0; i < headers.length; i += 1) out[headers[i]] = values[i] ?? '';
    return out;
  });
}

function datasetsFromFiles(files) {
  const datasets = {}, usedFiles = {};
  for (const [key, aliases] of Object.entries(FILE_ALIASES)) {
    const rows = [], matched = [];
    for (const alias of aliases) {
      const buffer = files.get(alias.toLowerCase());
      if (!buffer) continue;
      rows.push(...parseCsvBuffer(buffer)); matched.push(alias);
    }
    datasets[key] = rows; usedFiles[key] = matched;
  }
  return { datasets, usedFiles };
}

function duplicateStats(rows, keyFn) {
  const counts = new Map();
  for (const row of rows) { const key = keyFn(row); if (key) counts.set(key, (counts.get(key) || 0) + 1); }
  let groups = 0, rowsInGroups = 0;
  for (const count of counts.values()) if (count > 1) { groups += 1; rowsInGroups += count; }
  return { groups, rows: rowsInGroups };
}
function statusCounter(rows, field) {
  const out = {};
  for (const row of rows) { const key = clean(row[field] || 'sem_status', 80) || 'sem_status'; out[key] = (out[key] || 0) + 1; }
  return out;
}
function idSet(rows) { return new Set(rows.map((row) => clean(row.Id, 100)).filter(Boolean)); }
function missingRefs(rows, field, validSet) {
  let count = 0;
  for (const row of rows) { const value = clean(row[field], 100); if (value && !validSet.has(value)) count += 1; }
  return count;
}

export function analyzeSigeDataset(datasets = {}) {
  const people = datasets.people || [], products = datasets.products || [], entries = datasets.entries || [];
  const payments = datasets.payments || [], categories = datasets.categories || [], banks = datasets.banks || [];
  const sales = datasets.sales || [], saleItems = datasets.saleItems || [], nfe = datasets.nfe || [], nfeItems = datasets.nfeItems || [];
  const peopleIds = idSet(people), productIds = idSet(products), entryIds = idSet(entries), categoryIds = idSet(categories), bankIds = idSet(banks), saleIds = idSet(sales), nfeIds = idSet(nfe);
  const income = entries.filter((row) => normalize(row.Type) === 'income');
  const expense = entries.filter((row) => normalize(row.Type) === 'expense');
  const paidEntries = entries.filter((row) => truthy(row.Paid));
  const unpaidEntries = entries.filter((row) => !truthy(row.Paid));
  return {
    counts: { people: people.length, products: products.length, financialEntries: entries.length, receivables: income.length, payables: expense.length, payments: payments.length, accountCategories: categories.length, bankAccounts: banks.length, sales: sales.length, saleItems: saleItems.length, nfe: nfe.length, nfeItems: nfeItems.length, taxGroups: (datasets.taxGroups || []).length, fiscalOperations: (datasets.fiscalOperations || []).length },
    financial: {
      paidEntries: paidEntries.length, unpaidEntries: unpaidEntries.length,
      receivableTotal: money(income.reduce((sum, row) => sum + numberValue(row.Value), 0)),
      payableTotal: money(expense.reduce((sum, row) => sum + numberValue(row.Value), 0)),
      unpaidReceivableTotal: money(income.filter((row) => !truthy(row.Paid)).reduce((sum, row) => sum + numberValue(row.Value), 0)),
      unpaidPayableTotal: money(expense.filter((row) => !truthy(row.Paid)).reduce((sum, row) => sum + numberValue(row.Value), 0))
    },
    stock: {
      activeProducts: products.filter((row) => !truthy(row.InactiveProduct)).length,
      inactiveProducts: products.filter((row) => truthy(row.InactiveProduct)).length,
      totalUnits: money(products.reduce((sum, row) => sum + numberValue(row.Stock), 0)),
      costValue: money(products.reduce((sum, row) => sum + numberValue(row.Stock) * numberValue(row.CostPrice), 0)),
      saleValue: money(products.reduce((sum, row) => sum + numberValue(row.Stock) * numberValue(row.SellingPrice), 0))
    },
    duplicates: {
      peopleByDocument: duplicateStats(people, (row) => digits(row.CpfCnpj)), peopleByEmail: duplicateStats(people, (row) => normalizeEmail(row.Email)), peopleByPhone: duplicateStats(people, (row) => digits(row.Phone)),
      productsByCode: duplicateStats(products, (row) => normalizeCode(row.Code)), productsByBarcode: duplicateStats(products, (row) => digits(row.BarCode)), productsByName: duplicateStats(products, (row) => normalize(row.Name))
    },
    integrity: {
      financialPersonMissing: missingRefs(entries, 'PersonId', peopleIds), financialCategoryMissing: missingRefs(entries, 'AccountCategoryId', categoryIds), financialBankMissing: missingRefs(entries, 'BankAccountId', bankIds), financialSaleMissing: missingRefs(entries, 'SaleID', saleIds),
      paymentEntryMissing: missingRefs(payments, 'EntryId', entryIds), paymentBankMissing: missingRefs(payments, 'BankAccountId', bankIds), saleCustomerMissing: missingRefs(sales, 'CustomerId', peopleIds), saleSellerMissing: missingRefs(sales, 'SellerPersonId', peopleIds),
      saleItemSaleMissing: missingRefs(saleItems, 'SaleId', saleIds), saleItemProductMissing: missingRefs(saleItems, 'ProductId', productIds), nfeRecipientMissing: missingRefs(nfe, 'RecipientId', peopleIds), nfeSaleMissing: missingRefs(nfe, 'SaleId', saleIds), nfeItemInvoiceMissing: missingRefs(nfeItems, 'TaxInvoiceId', nfeIds), nfeItemProductMissing: missingRefs(nfeItems, 'ProductId', productIds)
    },
    nfeStatus: statusCounter(nfe, 'Status')
  };
}

function mapOfMany(rows, keyFn) {
  const map = new Map();
  for (const row of rows) { const key = keyFn(row); if (!key) continue; if (!map.has(key)) map.set(key, []); map.get(key).push(row); }
  return map;
}
function ownArianaProduct(product = {}) {
  const sellerId = normalize(product.sellerId || ''), sellerName = normalize(product.sellerName || '');
  if (!sellerId && !sellerName) return true;
  const joined = `${sellerId} ${sellerName}`;
  return joined.includes('ariana') || joined.includes('marcelo nunes');
}
function strongPeopleComparison(sourceRows, targetRows) {
  const byDocument = mapOfMany(targetRows, (row) => digits(row.cpf)), byEmail = mapOfMany(targetRows, (row) => normalizeEmail(row.email)), byPhone = mapOfMany(targetRows, (row) => digits(row.phone));
  const result = { exactDocument: 0, probableContact: 0, newCandidates: 0, conflicts: 0, sourceWithoutDocument: 0 };
  for (const row of sourceRows) {
    const document = digits(row.CpfCnpj), email = normalizeEmail(row.Email), phone = digits(row.Phone);
    if (!document) result.sourceWithoutDocument += 1;
    const docMatches = document ? (byDocument.get(document) || []) : [];
    if (docMatches.length === 1) { result.exactDocument += 1; continue; }
    if (docMatches.length > 1) { result.conflicts += 1; continue; }
    const candidateIds = new Set();
    if (email) for (const item of byEmail.get(email) || []) candidateIds.add(String(item._id));
    if (phone) for (const item of byPhone.get(phone) || []) candidateIds.add(String(item._id));
    if (candidateIds.size === 1) result.probableContact += 1;
    else if (candidateIds.size > 1) result.conflicts += 1;
    else result.newCandidates += 1;
  }
  return result;
}
function strongProductComparison(sourceRows, targetRows) {
  const ownRows = targetRows.filter(ownArianaProduct);
  const bySku = mapOfMany(ownRows, (row) => normalizeCode(row.sku));
  const byBarcode = mapOfMany(ownRows, (row) => digits(row?.specs?.ean || row?.specs?.barcode || row?.specs?.gtin || ''));
  const byName = mapOfMany(ownRows, (row) => normalize(row.name));
  const result = { exactCodeOrBarcode: 0, nameOnlyReview: 0, newCandidates: 0, conflicts: 0, targetOwnProducts: ownRows.length };
  for (const row of sourceRows) {
    const code = normalizeCode(row.Code), barcode = digits(row.BarCode);
    const skuMatches = code ? (bySku.get(code) || []) : [], barcodeMatches = barcode ? (byBarcode.get(barcode) || []) : [];
    const strongIds = new Set([...skuMatches, ...barcodeMatches].map((item) => String(item._id)));
    if (strongIds.size === 1) { result.exactCodeOrBarcode += 1; continue; }
    if (strongIds.size > 1 || skuMatches.length > 1 || barcodeMatches.length > 1) { result.conflicts += 1; continue; }
    const nameMatches = byName.get(normalize(row.Name)) || [];
    if (nameMatches.length) result.nameOnlyReview += 1; else result.newCandidates += 1;
  }
  return result;
}
function sourceCategoryType(value = '') {
  const key = normalize(value);
  if (key === 'income' || key === 'receita') return 'receita';
  if (key === 'expense' || key === 'despesa') return 'despesa';
  return '';
}
function compareCategories(sourceRows, targetRows) {
  const targetKeys = new Set(targetRows.map((row) => `${normalize(row.name)}|${normalize(row.type)}`));
  let exact = 0, newCandidates = 0;
  for (const row of sourceRows) { const key = `${normalize(row.Name || row.Description)}|${sourceCategoryType(row.Type || row.AccountType)}`; if (targetKeys.has(key)) exact += 1; else newCandidates += 1; }
  return { exact, newCandidates, targetCategories: targetRows.length };
}
function bankSourceAccount(row = {}) {
  const agency = clean(`${row.AgencyNumber || ''}${row.AgencyDigit ? `-${row.AgencyDigit}` : ''}`, 100);
  const account = clean(`${row.AccountNumber || row.Number || ''}${row.AccountDigit ? `-${row.AccountDigit}` : ''}`, 100);
  return { agency: normalizeCode(agency), account: normalizeCode(account) };
}
function compareBanks(sourceRows, targetRows) {
  const byName = mapOfMany(targetRows, (row) => normalize(row.name)), byAccount = mapOfMany(targetRows, (row) => `${normalizeCode(row.agency)}|${normalizeCode(row.account)}`);
  let exact = 0, review = 0, newCandidates = 0, conflicts = 0;
  for (const row of sourceRows) {
    const nameMatches = byName.get(normalize(row.Description || row.Name)) || [], sourceAccount = bankSourceAccount(row);
    const accountMatches = sourceAccount.account ? (byAccount.get(`${sourceAccount.agency}|${sourceAccount.account}`) || []) : [];
    const ids = new Set([...nameMatches, ...accountMatches].map((item) => String(item._id)));
    if (ids.size === 1 && (nameMatches.length || accountMatches.length)) exact += 1;
    else if (ids.size > 1) conflicts += 1;
    else if (nameMatches.length || accountMatches.length) review += 1;
    else newCandidates += 1;
  }
  return { exact, review, newCandidates, conflicts, targetBankAccounts: targetRows.length };
}
async function safeCollectionRows(name, projection = {}) {
  try { return await mongoose.connection.collection(name).find({}, { projection }).toArray(); } catch (_) { return []; }
}
async function compareWithAriana(datasets, context = {}) {
  const { User, Product, Order } = context;
  if (!User || !Product) return { available: false, reason: 'Modelos User/Product não disponíveis no contexto.' };
  const [users, products, categories, banks, targetOrders] = await Promise.all([
    User.find({}).select('_id name email cpf phone role').lean(),
    Product.find({}).select('_id name sku sellerId sellerName specs.ean specs.barcode specs.gtin').lean(),
    safeCollectionRows('erpaccountcategories', { name: 1, type: 1 }),
    safeCollectionRows('erpbankaccounts', { name: 1, bank: 1, agency: 1, account: 1 }),
    Order ? Order.countDocuments({}) : Promise.resolve(0)
  ]);
  return {
    available: true,
    targetCounts: { users: users.length, products: products.length, orders: targetOrders, accountCategories: categories.length, bankAccounts: banks.length },
    people: strongPeopleComparison(datasets.people || [], users),
    products: strongProductComparison(datasets.products || [], products),
    accountCategories: compareCategories(datasets.categories || [], categories),
    bankAccounts: compareBanks(datasets.banks || [], banks),
    matchingPolicy: {
      peopleAutoLink: 'Somente CPF/CNPJ exato e único.', peopleReview: 'E-mail/telefone sem documento ficam para revisão, sem mesclagem automática.',
      productsAutoLink: 'SKU/código ou EAN/código de barras exato e único.', productsReview: 'Nome igual sozinho nunca mescla produto automaticamente.',
      historicalTransactions: 'Vendas, financeiro, pagamentos e NF-e serão idempotentes pelo ID original do SIGE na etapa de gravação.'
    }
  };
}
function readiness(internal, target) {
  const blockers = [], warnings = [];
  if (!internal.counts.people) blockers.push('Cadastro de pessoas não encontrado.');
  if (!internal.counts.products) blockers.push('Cadastro de produtos não encontrado.');
  if (internal.integrity.paymentEntryMissing) blockers.push(`${internal.integrity.paymentEntryMissing} baixa(s) financeira(s) sem lançamento de origem.`);
  if (internal.integrity.saleItemSaleMissing) blockers.push(`${internal.integrity.saleItemSaleMissing} item(ns) apontam para venda inexistente.`);
  if (internal.integrity.saleItemProductMissing) blockers.push(`${internal.integrity.saleItemProductMissing} item(ns) de venda apontam para produto inexistente.`);
  if (internal.integrity.nfeItemInvoiceMissing) blockers.push(`${internal.integrity.nfeItemInvoiceMissing} item(ns) fiscal(is) sem NF-e de origem.`);
  if (internal.integrity.financialSaleMissing) warnings.push(`${internal.integrity.financialSaleMissing} lançamento(s) financeiro(s) referenciam vendas ausentes no recorte; serão preservados como histórico financeiro sem inventar vínculo.`);
  if (internal.duplicates.peopleByDocument.groups) warnings.push(`${internal.duplicates.peopleByDocument.groups} grupo(s) de pessoas têm CPF/CNPJ repetido dentro do SIGE e exigem revisão.`);
  if (internal.duplicates.productsByName.groups) warnings.push(`${internal.duplicates.productsByName.groups} grupo(s) de produtos têm nome repetido; o nome não será usado como chave automática.`);
  if (target?.people?.conflicts) warnings.push(`${target.people.conflicts} pessoa(s) do SIGE encontraram conflito entre registros atuais da Ariana.`);
  if (target?.products?.conflicts) warnings.push(`${target.products.conflicts} produto(s) do SIGE encontraram conflito de código/EAN na Ariana.`);
  return { safeForDryRun: true, safeForWrite: blockers.length === 0, blockers, warnings };
}

export function createErpSigeMigrationService(context = {}) {
  async function dryRun(file = null) {
    if (!file?.buffer) throw fail('Selecione o pacote ZIP de recuperação do SIGE.', 400, 'SIGE_PACKAGE_REQUIRED');
    const originalName = clean(file.originalname || '', 255).toLowerCase();
    if (originalName && !originalName.endsWith('.zip')) throw fail('Envie o pacote ZIP de recuperação do SIGE.', 400, 'SIGE_PACKAGE_TYPE');
    const csvFiles = extractCsvFilesFromZip(file.buffer);
    const { datasets, usedFiles } = datasetsFromFiles(csvFiles);
    const internal = analyzeSigeDataset(datasets);
    const target = await compareWithAriana(datasets, context);
    return {
      mode: 'dry-run', wroteToDatabase: false, generatedAt: new Date().toISOString(),
      source: { packageName: clean(file.originalname || 'pacote_sige.zip', 255), csvFilesFound: csvFiles.size, datasets: Object.fromEntries(Object.entries(usedFiles).map(([key, value]) => [key, { files: value, rows: (datasets[key] || []).length }])) },
      internal, target, readiness: readiness(internal, target),
      privacy: 'Resposta contém somente contagens e classificação de conflitos; CPF/CNPJ, e-mail, telefone e endereço não são devolvidos pelo dry-run.'
    };
  }
  return { dryRun };
}

export default createErpSigeMigrationService;
