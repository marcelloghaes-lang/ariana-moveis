import { Setting } from '../models/index.js';
import { APP_BASE_URL } from '../config/env.js';

export const WHATSAPP_EVOLUTION_DEFAULT_API_URL = process.env.EVOLUTION_API_URL || 'http://167.86.108.75:8082';
export const WHATSAPP_EVOLUTION_DEFAULT_INSTANCE =
  process.env.EVOLUTION_NOTIFY_INSTANCE ||
  process.env.EVOLUTION_INSTANCE_NOTIFICACOES ||
  'Ariana_Notificacoes';
export const WHATSAPP_EVOLUTION_DEFAULT_WEBHOOK_URL = process.env.EVOLUTION_WEBHOOK_URL || `${APP_BASE_URL || 'http://localhost:3000'}/api/whatsapp/webhook`;
export const DEFAULT_WHATSAPP_SETTINGS = { enabled: String(process.env.EVOLUTION_ENABLED || 'true').toLowerCase() !== 'false', apiUrl: WHATSAPP_EVOLUTION_DEFAULT_API_URL, apiKey: process.env.EVOLUTION_API_KEY || '', instanceName: WHATSAPP_EVOLUTION_DEFAULT_INSTANCE, webhookUrl: WHATSAPP_EVOLUTION_DEFAULT_WEBHOOK_URL, webhookEvents: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'SEND_MESSAGE', 'CONNECTION_UPDATE'], webhookByEvents: false, webhookBase64: false, autoNotifyOrderStatus: true, chatNotifyEnabled: true, defaultCountryCode: '55', statusTemplate: 'Olá, {customerName}! Seu pedido {orderId} na Ariana Móveis agora está em: {status}.{trackingLine}', testNumber: process.env.EVOLUTION_TEST_NUMBER || '', testMessage: 'Olá! Este é um teste de integração do WhatsApp da Ariana Móveis.', adminNotifyNumbers: process.env.EVOLUTION_ADMIN_NOTIFY_NUMBERS || process.env.EVOLUTION_ADMIN_NUMBER || '' };
export const DEFAULT_PAYMENTS_SETTINGS = {
  mercadopago: {
    enabled: true,
    accessToken: process.env.MP_ACCESS_TOKEN || '',
    publicKey: process.env.MP_PUBLIC_KEY || '',
    webhookSecret: process.env.MP_WEBHOOK_SECRET || '',
    splitEnabled: true,
    marketplaceFeePercent: Number(process.env.MARKETPLACE_COMMISSION_PERCENT || 12)
  },
  pagarme: {
    enabled: true,
    apiKey: process.env.PAGARME_API_KEY || '',
    publicKey: process.env.PAGARME_PUBLIC_KEY || '',
    endpoint: process.env.PAGARME_API_URL || 'https://api.pagar.me/core/v5',
    marketplaceRecipientId: process.env.PAGARME_MARKETPLACE_RECIPIENT_ID || '',
    splitEnabled: true,
    marketplaceFeePercent: Number(process.env.MARKETPLACE_COMMISSION_PERCENT || 12)
  },
  cielo: {
    enabled: false,
    merchantId: process.env.CIELO_MERCHANT_ID || '',
    merchantKey: process.env.CIELO_MERCHANT_KEY || '',
    apiUrl: process.env.CIELO_API_URL || 'https://api.cieloecommerce.cielo.com.br',
    marketplaceMerchantId: process.env.CIELO_MARKETPLACE_MERCHANT_ID || process.env.CIELO_SUBORDINATE_MARKETPLACE_ID || '',
    splitEnabled: true,
    marketplaceFeePercent: Number(process.env.MARKETPLACE_COMMISSION_PERCENT || 12)
  }
};
export const RODOCAP_ALLOWED_CITIES = ['AGUA BOA', 'AGUANIL', 'ANGELANDIA', 'ARAUJOS', 'ARCOS', 'ARICANDUVA', 'BAMBUI', 'BELO HORIZONTE', 'BETIM', 'BOCAIUVA', 'BORDA DA MATA', 'BRASILIA DE MINAS', 'CACHOEIRA DE MINAS', 'CAETABOPOLIS', 'CAMANDUCAIA', 'CAMBUI', 'CAMBUQUIRA', 'CAMPANHA', 'CAMPO BELO', 'CANDEIAS', 'CANTAGALO', 'CAPELINHA', 'CAPIM BRANCO', 'CAPITAO ENEAS', 'CAPITOLIO', 'CARBONITA', 'CAREACU', 'CARMO DO CAJURU', 'CHAPADA DO NORTE', 'CLAUDIO', 'CONCEICAO DO PARA', 'CONCEICAO DOS OUROS', 'CONFINS', 'CONGONHAL', 'CONTAGEM', 'CORINTO', 'CORREGO FUNDO', 'COUTO DE MAGALHAES DE MINAS', 'CRISTAIS', 'CURVELO', 'DATAS', 'DIAMANTINA', 'DIVINOLANDIA DE MINAS', 'DIVINOPOLIS', 'DORES DE GUANHAES', 'ESTIVA', 'FELIXLANDIA', 'FERROS', 'FORMIGA', 'FRANCISCO SA', 'GOUVEIA', 'GUANHAES', 'IBIRITE', 'IGARATINGA', 'IGUATAMA', 'INIMUTABA', 'ITABIRA', 'ITAMARANDIBA', 'ITAUNA', 'JANAUBA', 'JANUARIA', 'JAPONVAR', 'JOSE RAYDAN', 'LAGOA DA PRATA', 'LAGOA SANTA', 'LAVRAS', 'LONTRA', 'MATERLANDIA', 'MATOZINHOS', 'MINAS NOVAS', 'MIRABELA', 'MONTES CLAROS', 'NOVA LIMA', 'NOVA PORTEIRINHA', 'NOVA SERRANA', 'OLIVEIRA', 'PAINS', 'PARA DE MINAS', 'PARAOPEBA', 'PECANHA', 'PERDIGAO', 'PERDOES', 'PIMENTA', 'PITANGUI', 'PIUMHI', 'PORTEIRINHA', 'POUSO ALEGRE', 'PRUDENTE DE MORAIS', 'RIBEIRAO DAS NEVES', 'RIO VERMELHO', 'SABARA', 'SABINOPOLIS', 'SALINAS', 'SANTA LUZIA', 'SANTA MARIA DE ITABIRA', 'SANTA MARIA DO SUACUI', 'SANTA RITA DO SAPUCAI', 'SANTANA DO JACARE', 'SAO BENTO ABADE', 'SAO GONCALO DO PARA', 'SAO JOAO EVANGELISTA', 'SAO JOSE DA LAPA', 'SAO JOSE DO JACURI', 'SAO PEDRO DO SUACUI', 'SAO SEBASTIAO DA BELA VISTA', 'SAO SEBASTIAO DO OESTE', 'SAO SEBASTIAO DO SAPUCAI', 'SARZEDO', 'SENHORA DO PORTO', 'SERRO', 'SETE LAGOAS', 'SILVIANOPOLIS', 'TAIOBEIRAS', 'TRES CORACOES', 'TURMALINA', 'VARGINHA', 'VEREDINHA', 'VESPASIANO', 'VIRGINOPOLIS', 'ARUJA', 'BARUERI', 'CAJAMAR', 'CAMPINAS', 'CARAPICUIBA', 'COTIA', 'DIADEMA', 'EMBU DAS ARTES', 'FERRAZ DE VASCONCELOS', 'GUARULHOS', 'HORTOLANDIA', 'INDAIATUBA', 'ITAPECERICA DA SERRA', 'ITAQUAQUECETUBA', 'ITUPEVA', 'JANDIRA', 'JUNDIAI', 'LOUVEIRA', 'MAUA', 'MOGI DAS CRUZES', 'OSASCO', 'POA', 'RIBEIRAO PIRES', 'SANTANA DE PARNAIBA', 'SANTO ANDRE', 'SAO BERNARDO DO CAMPO', 'SAO CAETANO DO SUL', 'SAO PAULO', 'SUZANO', 'TABOAO DA SERRA', 'VALINHOS', 'VARGEM GRANDE PAULISTA', 'VARZEA PAULISTA', 'VINHEDO'];
export const DEFAULT_SHIPPING_SETTINGS = { montagemPercent: 0.12, correios: { enabled: true, origemCep: process.env.LOJA_ORIGEM_CEP || '', servicos: String(process.env.CORREIOS_SERVICOS || '03298,03328').split(',').map(s => String(s).trim()).filter(Boolean), pesoKgPadrao: 1, alturaCmPadrao: 10, larguraCmPadrao: 15, comprimentoCmPadrao: 20, valorDeclaradoPadrao: 0, maxWeightKg: 30, maxDimensionCm: 100 }, businessRules: { arianaMoveis: { enabled: true, sellerNames: ['ARIANA MOVEIS', 'ARIANA MÓVEIS'], freeCepStart: '39740-000', freeCepEnd: '39740-000', localOriginCep: '39740-000', localMaxKmTier1: 30, localPriceTier1: 80, localMaxKmTier2: 70, localPriceTier2: 120, phoneFlatPrice: 19.90, phoneFlatEnabled: true, label: 'Ariana Entrega', prazo: '1 a 3 dias úteis' }, snDigital: { enabled: false, appliesToArianaLogistics: false, maxKmTier1: 30, priceTier1: 80, maxKmTier2: 70, priceTier2: 120, label: 'Ariana Entrega', prazo: '1 a 3 dias úteis' }, rodocap: { enabled: true, appliesToArianaLogistics: true, minKmExclusive: 70, percentOfInvoice: 0.12, label: 'Rodocap', prazoPadrao: 'sob consulta', allowedCities: RODOCAP_ALLOWED_CITIES, onlyUrbanArea: true } }, carriers: { correios: { enabled: true, maxWeightKg: 30, maxDimensionCm: 100 }, frenet: { enabled: String(process.env.FRENET_ENABLED || '').toLowerCase() === 'true' || !!process.env.FRENET_TOKEN || !!process.env.FRENET_API_TOKEN, token: process.env.FRENET_TOKEN || process.env.FRENET_API_TOKEN || '', apiUrl: process.env.FRENET_API_URL || 'https://api.frenet.com.br', origemCep: process.env.FRENET_ORIGIN_CEP || process.env.LOJA_ORIGEM_CEP || '', maxWeightKg: Number(process.env.FRENET_MAX_WEIGHT_KG || 100), maxDimensionCm: Number(process.env.FRENET_MAX_DIMENSION_CM || 200) }, totalExpress: { enabled: false, maxWeightKg: 30, maxDimensionCm: 110 }, ownDelivery: { enabled: true, tiers: [{ maxKm: 30, price: 80 }, { maxKm: 70, price: 120 }] } } };

export async function getSetting(key, fallback = null) { const doc = await Setting.findOne({ key }); return doc ? doc.value : fallback; }
export async function setSetting(key, value, updatedBy = 'system') { const doc = await Setting.findOneAndUpdate({ key }, { $set: { value, updatedBy } }, { upsert: true, new: true }); return doc.value; }
export async function getWhatsappSettings() {
  const value = await getSetting('whatsapp_evolution', DEFAULT_WHATSAPP_SETTINGS);
  const merged = { ...DEFAULT_WHATSAPP_SETTINGS, ...(value || {}) };

  // Garante que variáveis do Render não sejam anuladas por configuração antiga/vazia salva no MongoDB.
  merged.enabled = String(process.env.EVOLUTION_ENABLED || (merged.enabled === false ? 'false' : 'true')).toLowerCase() !== 'false';
  merged.apiUrl = String(process.env.EVOLUTION_API_URL || merged.apiUrl || WHATSAPP_EVOLUTION_DEFAULT_API_URL || '').trim();
  // Usa sempre a instância de NOTIFICAÇÕES para vendas/status, sem cair na instância SAC.
  merged.instanceName = String(
    process.env.EVOLUTION_NOTIFY_INSTANCE ||
    process.env.EVOLUTION_INSTANCE_NOTIFICACOES ||
    'Ariana_Notificacoes'
  ).trim();
  merged.apiKey = String(process.env.EVOLUTION_API_KEY || merged.apiKey || '').trim();
  merged.adminNotifyNumbers = String(process.env.EVOLUTION_ADMIN_NOTIFY_NUMBERS || process.env.EVOLUTION_ADMIN_NUMBER || merged.adminNotifyNumbers || '').trim();
  merged.defaultCountryCode = String(merged.defaultCountryCode || '55').trim();
  merged.autoNotifyOrderStatus = merged.autoNotifyOrderStatus !== false;
  merged.chatNotifyEnabled = merged.chatNotifyEnabled !== false;
  return merged;
}
export async function saveWhatsappSettings(data, updatedBy = 'system') { const current = await getWhatsappSettings(); const merged = { ...current, ...(data || {}) }; merged.instanceName = String(process.env.EVOLUTION_NOTIFY_INSTANCE || process.env.EVOLUTION_INSTANCE_NOTIFICACOES || 'Ariana_Notificacoes').trim(); await setSetting('whatsapp_evolution', merged, updatedBy); return merged; }
export async function getPaymentsSettings() {
  const value = await getSetting('payments', DEFAULT_PAYMENTS_SETTINGS);
  return {
    mercadopago: { ...DEFAULT_PAYMENTS_SETTINGS.mercadopago, ...(value?.mercadopago || {}) },
    pagarme: { ...DEFAULT_PAYMENTS_SETTINGS.pagarme, ...(value?.pagarme || {}) },
    cielo: { ...DEFAULT_PAYMENTS_SETTINGS.cielo, ...(value?.cielo || {}) }
  };
}
export async function saveShippingSettings(data, updatedBy = 'system') { const current = await getShippingSettings(); const incoming = data || {}; const merged = { ...current, ...incoming, correios: { ...(current.correios || {}), ...((incoming && incoming.correios) || {}) }, businessRules: { ...(current.businessRules || {}), ...((incoming && incoming.businessRules) || {}), arianaMoveis: { ...((current.businessRules || {}).arianaMoveis || {}), ...(((incoming && incoming.businessRules) || {}).arianaMoveis || {}) }, snDigital: { ...((current.businessRules || {}).snDigital || {}), ...(((incoming && incoming.businessRules) || {}).snDigital || {}) }, rodocap: { ...((current.businessRules || {}).rodocap || {}), ...(((incoming && incoming.businessRules) || {}).rodocap || {}), allowedCities: Array.isArray((((incoming && incoming.businessRules) || {}).rodocap || {}).allowedCities) && (((incoming && incoming.businessRules) || {}).rodocap || {}).allowedCities.length ? (((incoming && incoming.businessRules) || {}).rodocap || {}).allowedCities : (((current.businessRules || {}).rodocap || {}).allowedCities || RODOCAP_ALLOWED_CITIES) } }, carriers: { ...(current.carriers || {}), ...((incoming && incoming.carriers) || {}), correios: { ...((current.carriers || {}).correios || {}), ...(((incoming && incoming.carriers) || {}).correios || {}), enabled: ((incoming && incoming.correios && incoming.correios.enabled !== undefined) ? incoming.correios.enabled : ((((incoming && incoming.carriers) || {}).correios || {}).enabled ?? ((current.carriers || {}).correios || {}).enabled)), maxWeightKg: Number((((incoming && incoming.correios) || {}).maxWeightKg) || ((((incoming && incoming.carriers) || {}).correios || {}).maxWeightKg) || (((current.carriers || {}).correios || {}).maxWeightKg) || 30), maxDimensionCm: Number((((incoming && incoming.correios) || {}).maxDimensionCm) || ((((incoming && incoming.carriers) || {}).correios || {}).maxDimensionCm) || (((current.carriers || {}).correios || {}).maxDimensionCm) || 100) } } }; await setSetting('shipping', merged, updatedBy); return merged; }
export async function getShippingSettings() { const value = await getSetting('shipping', DEFAULT_SHIPPING_SETTINGS); const merged = { ...DEFAULT_SHIPPING_SETTINGS, ...(value || {}), correios: { ...(DEFAULT_SHIPPING_SETTINGS.correios || {}), ...(((value || {}).correios) || {}) }, businessRules: { ...(DEFAULT_SHIPPING_SETTINGS.businessRules || {}), ...(((value || {}).businessRules) || {}), arianaMoveis: { ...((DEFAULT_SHIPPING_SETTINGS.businessRules || {}).arianaMoveis || {}), ...((((value || {}).businessRules) || {}).arianaMoveis || {}) }, snDigital: { ...((DEFAULT_SHIPPING_SETTINGS.businessRules || {}).snDigital || {}), ...((((value || {}).businessRules) || {}).snDigital || {}) }, rodocap: { ...((DEFAULT_SHIPPING_SETTINGS.businessRules || {}).rodocap || {}), ...((((value || {}).businessRules) || {}).rodocap || {}), allowedCities: Array.isArray(((((value || {}).businessRules) || {}).rodocap || {}).allowedCities) && ((((value || {}).businessRules) || {}).rodocap || {}).allowedCities.length ? ((((value || {}).businessRules) || {}).rodocap || {}).allowedCities : (((DEFAULT_SHIPPING_SETTINGS.businessRules || {}).rodocap || {}).allowedCities || RODOCAP_ALLOWED_CITIES) } }, carriers: { ...(DEFAULT_SHIPPING_SETTINGS.carriers || {}), ...(((value || {}).carriers) || {}) } }; merged.carriers = merged.carriers || {}; merged.carriers.correios = { ...(DEFAULT_SHIPPING_SETTINGS.carriers.correios || {}), ...((merged.carriers || {}).correios || {}), enabled: merged.correios.enabled !== undefined ? merged.correios.enabled : ((merged.carriers || {}).correios || {}).enabled, maxWeightKg: Number((merged.correios.maxWeightKg !== undefined ? merged.correios.maxWeightKg : ((merged.carriers || {}).correios || {}).maxWeightKg) || 30), maxDimensionCm: Number((merged.correios.maxDimensionCm !== undefined ? merged.correios.maxDimensionCm : ((merged.carriers || {}).correios || {}).maxDimensionCm) || 100) };
merged.carriers.frenet = { ...(DEFAULT_SHIPPING_SETTINGS.carriers.frenet || {}), ...((merged.carriers || {}).frenet || {}) };
merged.carriers.frenet.enabled = String(process.env.FRENET_ENABLED || (merged.carriers.frenet.enabled === false ? 'false' : '')).toLowerCase() === 'false' ? false : (merged.carriers.frenet.enabled !== false);
merged.carriers.frenet.token = String(process.env.FRENET_TOKEN || process.env.FRENET_API_TOKEN || merged.carriers.frenet.token || '').trim();
merged.carriers.frenet.apiUrl = String(process.env.FRENET_API_URL || merged.carriers.frenet.apiUrl || 'https://api.frenet.com.br').replace(/\/+$/, '');
merged.carriers.frenet.origemCep = String(process.env.FRENET_ORIGIN_CEP || process.env.LOJA_ORIGEM_CEP || merged.carriers.frenet.origemCep || merged.correios.origemCep || '').trim();
return merged; }
