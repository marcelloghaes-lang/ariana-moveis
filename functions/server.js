
require('dotenv').config(); // 1º: Carrega a senha do .env primeiro!
const connectDB = require('./config/database'); // 2º: Importa a lógica do banco

connectDB(); // 3º: Agora sim, conecta usando a senha carregada
require('dotenv').config(); // Carrega as variáveis do arquivo .env

/* MIGRAÇÃO AUTOMÁTICA DE COMPATIBILIDADE: FIREBASE -> NODE/MONGO
 * Objetivo: preservar o arquivo original completo e trocar a infraestrutura base
 * de Firebase Functions/Admin/Firestore por uma camada compatível em MongoDB.
 * Atenção: triggers Firestore viram handlers compatíveis e precisam ser acionados
 * pelo servidor/processos do backend quando aplicável.
 */

const __compatModule = require("module");
const __compatOriginalRequire = __compatModule.prototype.require;
const __compatJwt = require("jsonwebtoken");
const { MongoClient, ObjectId } = require("mongodb");

const __compatState = {
  mongoClient: null,
  mongoDb: null,
  mongoReady: null,
  firestoreInstance: null,
};

function __compatEnvFirst(...keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

async function __compatGetMongoDb() {
  if (__compatState.mongoDb) return __compatState.mongoDb;
  if (!__compatState.mongoReady) {
    __compatState.mongoReady = (async () => {
      const uri = __compatEnvFirst("MONGODB_URI", "MONGO_URI", "DATABASE_URL");
      const dbName = __compatEnvFirst("MONGODB_DB", "MONGO_DB", "DATABASE_NAME") || "ariana_moveis";
      if (!uri) throw new Error("MONGODB_URI não configurada para a camada compatível.");
      __compatState.mongoClient = new MongoClient(uri, { ignoreUndefined: true });
      await __compatState.mongoClient.connect();
      __compatState.mongoDb = __compatState.mongoClient.db(dbName);
      return __compatState.mongoDb;
    })();
  }
  return __compatState.mongoReady;
}

function __compatMaybeObjectId(value) {
  try {
    if (value instanceof ObjectId) return value;
    if (ObjectId.isValid(String(value))) return new ObjectId(String(value));
  } catch (_) {}
  return null;
}

function __compatNormalizeDoc(doc) {
  if (!doc) return doc;
  if (doc._id && !doc.id) doc.id = String(doc._id);
  return doc;
}

function __compatValueToMillis(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const d = new Date(value);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function __compatClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function __compatTimestampNow() {
  const date = new Date();
  return {
    _date: date,
    toDate() { return new Date(this._date); },
    toMillis() { return this._date.getTime(); },
    seconds: Math.floor(date.getTime() / 1000),
    nanoseconds: 0,
  };
}

const __compatFieldValue = {
  serverTimestamp() { return { __op: "serverTimestamp" }; },
  arrayUnion(...items) { return { __op: "arrayUnion", items }; },
};

function __compatSplitPath(path) {
  return String(path || "").split("/").filter(Boolean);
}

function __compatCollectionNameForPath(path) {
  const parts = __compatSplitPath(path);
  if (parts.length % 2 === 1) return parts.join("__");
  return parts.slice(0, -1).join("__");
}

function __compatDocIdForPath(path) {
  const parts = __compatSplitPath(path);
  return parts[parts.length - 1] || "";
}

function __compatGetByPath(obj, path) {
  const parts = String(path || "").split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function __compatSetByPath(obj, path, value) {
  const parts = String(path || "").split(".");
  let cur = obj;
  while (parts.length > 1) {
    const p = parts.shift();
    if (!cur[p] || typeof cur[p] !== "object" || Array.isArray(cur[p])) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[0]] = value;
}

function __compatApplyPatch(base, patch) {
  const out = base && typeof base === "object" ? __compatClone(base) : {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === "object" && value.__op === "serverTimestamp") {
      __compatSetByPath(out, key, __compatTimestampNow());
      continue;
    }
    if (value && typeof value === "object" && value.__op === "arrayUnion") {
      const existing = __compatGetByPath(out, key);
      const arr = Array.isArray(existing) ? existing.slice() : [];
      for (const item of value.items || []) arr.push(item);
      __compatSetByPath(out, key, arr);
      continue;
    }
    __compatSetByPath(out, key, value);
  }
  return out;
}

function __compatMatchesWhere(doc, clause) {
  const actual = __compatGetByPath(doc, clause.field);
  const expected = clause.value;
  switch (clause.op) {
    case "==": return JSON.stringify(actual) === JSON.stringify(expected);
    case "!=": return JSON.stringify(actual) !== JSON.stringify(expected);
    case ">": return actual > expected;
    case ">=": return actual >= expected;
    case "<": return actual < expected;
    case "<=": return actual <= expected;
    case "array-contains": return Array.isArray(actual) && actual.some((v) => JSON.stringify(v) === JSON.stringify(expected));
    case "in": return Array.isArray(expected) && expected.some((v) => JSON.stringify(v) === JSON.stringify(actual));
    default: return true;
  }
}

class __compatDocumentSnapshot {
  constructor(ref, doc) {
    this.ref = ref;
    this.id = ref.id;
    this._doc = doc ? __compatNormalizeDoc(doc) : null;
    this.exists = !!doc;
  }
  data() {
    return this._doc ? __compatClone(this._doc) : undefined;
  }
}

class __compatQuerySnapshot {
  constructor(docs) {
    this.docs = docs || [];
    this.empty = this.docs.length === 0;
    this.size = this.docs.length;
  }
  forEach(fn) {
    this.docs.forEach(fn);
  }
}

class __compatDocumentReference {
  constructor(firestore, collectionName, id, fullPath = null) {
    this._firestore = firestore;
    this._collectionName = collectionName;
    this.id = String(id);
    this.path = fullPath || `${collectionName}/${id}`;
  }
  async get() {
    const db = await __compatGetMongoDb();
    const col = db.collection(this._collectionName);
    let doc = null;
    const oid = __compatMaybeObjectId(this.id);
    if (oid) doc = await col.findOne({ _id: oid });
    if (!doc) doc = await col.findOne({ $or: [{ id: this.id }, { uid: this.id }, { _id: this.id }] });
    return new __compatDocumentSnapshot(this, doc);
  }
  async set(data, options = {}) {
    const db = await __compatGetMongoDb();
    const col = db.collection(this._collectionName);
    const snap = await this.get();
    const base = snap.exists ? (snap.data() || {}) : {};
    let payload = options && options.merge ? __compatApplyPatch(base, data || {}) : __compatApplyPatch({}, data || {});
    if (!payload.createdAt) payload.createdAt = base.createdAt || __compatTimestampNow();
    if (!payload.updatedAt) payload.updatedAt = __compatTimestampNow();
    payload.id = this.id;

    const existingOid = __compatMaybeObjectId(base && base._id ? base._id : null);
    const docOid = __compatMaybeObjectId(this.id);

    delete payload._id;

    if (existingOid) payload._id = existingOid;
    else if (docOid) payload._id = docOid;

    const filter = existingOid ? { _id: existingOid } : (docOid ? { _id: docOid } : { id: this.id });
    await col.replaceOne(filter, payload, { upsert: true });
    return this;
  }
  async update(data) {
    const snap = await this.get();
    if (!snap.exists) throw new Error(`Documento ${this.path} não encontrado.`);
    return this.set(data, { merge: true });
  }
  async delete() {
    const db = await __compatGetMongoDb();
    const col = db.collection(this._collectionName);
    const oid = __compatMaybeObjectId(this.id);
    await col.deleteOne(oid ? { _id: oid } : { id: this.id });
  }
  collection(child) {
    const path = this.path ? `${this.path}/${child}` : child;
    return new __compatCollectionReference(this._firestore, __compatCollectionNameForPath(path), path);
  }
}

class __compatCollectionReference {
  constructor(firestore, collectionName, fullPath = null) {
    this._firestore = firestore;
    this._collectionName = collectionName;
    this.path = fullPath || collectionName;
  }
  doc(id = null) {
    const finalId = id ? String(id) : new ObjectId().toString();
    const fullPath = this.path ? `${this.path}/${finalId}` : `${this._collectionName}/${finalId}`;
    return new __compatDocumentReference(this._firestore, this._collectionName, finalId, fullPath);
  }
  where(field, op, value) {
    return new __compatQuery(this._firestore, this._collectionName, this.path, [{ type: "where", field, op, value }], null, 0);
  }
  orderBy(field, direction = "asc") {
    return new __compatQuery(this._firestore, this._collectionName, this.path, [], { field, direction }, 0);
  }
  limit(value) {
    return new __compatQuery(this._firestore, this._collectionName, this.path, [], null, Number(value) || 0);
  }
  async add(data) {
    const ref = this.doc();
    await ref.set(data || {}, { merge: false });
    return ref;
  }
  async get() {
    return new __compatQuery(this._firestore, this._collectionName, this.path, [], null, 0).get();
  }
}

class __compatQuery {
  constructor(firestore, collectionName, path, whereClauses = [], order = null, limitValue = 0) {
    this._firestore = firestore;
    this._collectionName = collectionName;
    this.path = path;
    this._whereClauses = whereClauses || [];
    this._order = order;
    this._limit = limitValue || 0;
  }
  where(field, op, value) {
    return new __compatQuery(this._firestore, this._collectionName, this.path, [...this._whereClauses, { type: "where", field, op, value }], this._order, this._limit);
  }
  orderBy(field, direction = "asc") {
    return new __compatQuery(this._firestore, this._collectionName, this.path, this._whereClauses, { field, direction }, this._limit);
  }
  limit(value) {
    return new __compatQuery(this._firestore, this._collectionName, this.path, this._whereClauses, this._order, Number(value) || 0);
  }
  async get() {
    const db = await __compatGetMongoDb();
    const docs = (await db.collection(this._collectionName).find({}).toArray()).map(__compatNormalizeDoc);
    let rows = docs.filter((doc) => this._whereClauses.every((c) => __compatMatchesWhere(doc, c)));
    if (this._order && this._order.field) {
      const field = this._order.field;
      const dir = String(this._order.direction || "asc").toLowerCase() === "desc" ? -1 : 1;
      rows.sort((a, b) => {
        const av = __compatGetByPath(a, field);
        const bv = __compatGetByPath(b, field);
        const am = __compatValueToMillis(av);
        const bm = __compatValueToMillis(bv);
        if (am || bm) return (am - bm) * dir;
        if (av === bv) return 0;
        return av > bv ? dir : -dir;
      });
    }
    if (this._limit > 0) rows = rows.slice(0, this._limit);
    const snaps = rows.map((doc) => new __compatDocumentSnapshot(new __compatDocumentReference(this._firestore, this._collectionName, doc.id || String(doc._id), `${this.path}/${doc.id || String(doc._id)}`), doc));
    return new __compatQuerySnapshot(snaps);
  }
}

class __compatTransaction {
  constructor(firestore) { this._firestore = firestore; }
  async get(ref) { return ref.get(); }
  set(ref, data, options) { return ref.set(data, options); }
  update(ref, data) { return ref.update(data); }
  delete(ref) { return ref.delete(); }
}

class __compatFirestore {
  collection(path) {
    return new __compatCollectionReference(this, __compatCollectionNameForPath(path), path);
  }
  doc(path) {
    return new __compatDocumentReference(this, __compatCollectionNameForPath(path), __compatDocIdForPath(path), path);
  }
  async runTransaction(fn) {
    const tx = new __compatTransaction(this);
    return fn(tx);
  }
}

function __compatGetFirestoreInstance() {
  if (!__compatState.firestoreInstance) __compatState.firestoreInstance = new __compatFirestore();
  return __compatState.firestoreInstance;
}

const __compatAdmin = {
  apps: [],
  initializeApp(config = {}) {
    if (!this.apps.length) this.apps.push({ name: "mongo-admin", options: config || {} });
    return this.apps[0];
  },
  firestore: Object.assign(function firestore() {
    return __compatGetFirestoreInstance();
  }, {
    FieldValue: __compatFieldValue,
    Timestamp: { now: __compatTimestampNow },
  }),
  auth() {
    return {
      async verifyIdToken(token) {
        const secret = __compatEnvFirst("JWT_SECRET", "AUTH_JWT_SECRET") || "ariana_moveis_secret";
        try {
          const decoded = __compatJwt.verify(String(token || ""), secret);
          return { ...decoded, uid: decoded.uid || decoded.id || decoded.sub || null };
        } catch (_) {
          const decoded = __compatJwt.decode(String(token || "")) || {};
          if (decoded && (decoded.uid || decoded.id || decoded.sub)) {
            return { ...decoded, uid: decoded.uid || decoded.id || decoded.sub };
          }
          throw new Error("invalid_auth");
        }
      },
      async generatePasswordResetLink(email, options = {}) {
        const base = options.url || __compatEnvFirst("RESET_CONTINUE_URL", "APP_BASE_URL") || "http://localhost:3000/login_seller.html";
        const token = __compatJwt.sign({ email: String(email || "").trim().toLowerCase(), type: "reset" }, __compatEnvFirst("JWT_SECRET", "AUTH_JWT_SECRET") || "ariana_moveis_secret", { expiresIn: "1h" });
        const sep = String(base).includes("?") ? "&" : "?";
        return `${base}${sep}mode=resetPassword&oobCode=${encodeURIComponent(token)}&email=${encodeURIComponent(String(email || "").trim().toLowerCase())}`;
      },
    };
  },
};

function __compatOnRequest(_options, handler) { return handler; }
function __compatSetGlobalOptions() {}
function __compatOnDocumentWritten(config, handler) {
  handler.__trigger = { type: "documentWritten", document: config && config.document ? config.document : null };
  return handler;
}

__compatModule.prototype.require = function patchedCompatRequire(id) {
  if (id === "firebase-admin") return __compatAdmin;
  if (id === "firebase-functions/v2/https") return { onRequest: __compatOnRequest };
  if (id === "firebase-functions/v2") return { setGlobalOptions: __compatSetGlobalOptions };
  if (id === "firebase-functions/v2/firestore") return { onDocumentWritten: __compatOnDocumentWritten };
  return __compatOriginalRequire.apply(this, arguments);
};

/* eslint-disable */
const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const initPagarmeManufacturerModule = require("./pagarme-manufacturer-module");

setGlobalOptions({ region: "southamerica-east1" });

// Admin SDK (para triggers Firestore fora do Express)
const adminGlobal = require("firebase-admin");
if (adminGlobal.apps.length === 0) adminGlobal.initializeApp();

// ID do build (para você ver se o deploy aplicou)
const BUILD_ID = "enterprise-sla-2026-03-15-whatsapp-fix";
const WHATSAPP_EVOLUTION_DEFAULT_API_URL = "http://167.86.108.75:8081";
const WHATSAPP_EVOLUTION_DEFAULT_INSTANCE = "Ariana_Oficial";
const WHATSAPP_EVOLUTION_DEFAULT_WEBHOOK_URL = "https://southamerica-east1-ariana-moveis-final.cloudfunctions.net/api/whatsapp-callback";
const INTEGRATION_AUDIT_COLLECTION = "manufacturer_audit_logs";

const OPERATIONAL_ALERT_COLLECTION = "manufacturer_operational_alerts";

const SETTINGS_COLLECTION = "settings";
const WHATSAPP_EVOLUTION_SETTINGS_DOC = "whatsapp_evolution";
const WHATSAPP_WEBHOOK_EVENTS_DEFAULT = [
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "SEND_MESSAGE",
  "CONNECTION_UPDATE",
];

function waSettingsRef() {
  return adminGlobal.firestore().collection(SETTINGS_COLLECTION).doc(WHATSAPP_EVOLUTION_SETTINGS_DOC);
}

function waDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function waNormalizeNumber(value, defaultCountryCode = "55") {
  let digits = waDigits(value);
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if ((digits.length === 10 || digits.length === 11) && defaultCountryCode) digits = `${defaultCountryCode}${digits}`;
  return digits;
}

function waNormalizeSettings(input = {}, existing = {}) {
  const merged = { ...(existing || {}), ...(input || {}) };
  const apiUrl = String(merged.apiUrl || merged.baseUrl || merged.serverUrl || WHATSAPP_EVOLUTION_DEFAULT_API_URL).trim().replace(/\/+$/, "");
  const webhookUrl = String(merged.webhookUrl || merged.callbackUrl || WHATSAPP_EVOLUTION_DEFAULT_WEBHOOK_URL).trim();
  const eventsRaw = Array.isArray(merged.webhookEvents) ? merged.webhookEvents : (Array.isArray(merged.events) ? merged.events : WHATSAPP_WEBHOOK_EVENTS_DEFAULT);
  const webhookEvents = eventsRaw.map((x) => String(x || "").trim()).filter(Boolean);
  return {
    enabled: merged.enabled !== false,
    apiUrl,
    apiKey: String(merged.apiKey || merged.apikey || "").trim(),
    instanceName: String(merged.instanceName || merged.instance || WHATSAPP_EVOLUTION_DEFAULT_INSTANCE).trim(),
    webhookUrl,
    webhookEvents: webhookEvents.length ? webhookEvents : [...WHATSAPP_WEBHOOK_EVENTS_DEFAULT],
    webhookByEvents: merged.webhookByEvents === true,
    webhookBase64: merged.webhookBase64 === true,
    autoNotifyOrderStatus: merged.autoNotifyOrderStatus !== false,
    defaultCountryCode: String(merged.defaultCountryCode || "55").replace(/\D/g, "") || "55",
    statusTemplate: String(merged.statusTemplate || "Olá, {customerName}! Seu pedido {orderId} na Ariana Móveis agora está em: {status}.{trackingLine}").trim(),
    testNumber: waNormalizeNumber(merged.testNumber || "", String(merged.defaultCountryCode || "55").replace(/\D/g, "") || "55") || null,
    testMessage: String(merged.testMessage || "Olá! Este é um teste de integração do WhatsApp da Ariana Móveis.").trim(),
    chatNotifyEnabled: merged.chatNotifyEnabled !== false,
    adminNotifyNumbers: String(merged.adminNotifyNumbers || "").trim(),
    updatedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
  };
}

function waRedactSettings(settings = {}) {
  const cfg = { ...(settings || {}) };
  if (cfg.apiKey) cfg.apiKey = "[redacted]";
  return cfg;
}

async function waGetSettings() {
  const snap = await waSettingsRef().get();
  if (!snap.exists) return waNormalizeSettings({
    apiUrl: WHATSAPP_EVOLUTION_DEFAULT_API_URL,
    instanceName: WHATSAPP_EVOLUTION_DEFAULT_INSTANCE,
    webhookUrl: WHATSAPP_EVOLUTION_DEFAULT_WEBHOOK_URL,
    webhookEvents: [...WHATSAPP_WEBHOOK_EVENTS_DEFAULT],
  }, {});
  return waNormalizeSettings(snap.data() || {}, {});
}

async function waSaveSettings(input = {}) {
  const existing = await waGetSettings();
  const normalized = waNormalizeSettings(input, existing);
  await waSettingsRef().set(normalized, { merge: true });
  return normalized;
}

function waBuildTrackingLine(order = {}, trackingCode = "") {
  const code = String(trackingCode || order.trackingCode || order.codigoRastreio || order.tracking_code || "").trim();
  return code ? ` Código de rastreio: ${code}` : "";
}

function waExtractOrderPhone(order = {}, defaultCountryCode = "55") {
  const possible = [
    order.whatsapp,
    order.telefoneWhatsapp,
    order.telefone,
    order.phone,
    order.customerPhone,
    order.customerWhatsapp,
    order.customer?.phone,
    order.customer?.whatsapp,
    order.customerProfile?.telefone,
    order.customerProfile?.phone,
    order.shippingAddress?.phone,
    order.delivery_address?.phone,
  ];
  for (const item of possible) {
    const n = waNormalizeNumber(item, defaultCountryCode);
    if (n) return n;
  }
  return "";
}

function waExtractOrderCustomerName(order = {}) {
  return String(
    order.customerName ||
    order.nomeCliente ||
    order.nome ||
    order.customer?.name ||
    order.customer?.nome ||
    order.customerProfile?.nome ||
    order.user?.name ||
    order.email ||
    "Cliente"
  ).trim() || "Cliente";
}

function waBuildOrderStatusMessage(orderId, order = {}, settings = {}) {
  const template = String(settings.statusTemplate || "Olá, {customerName}! Seu pedido {orderId} na Ariana Móveis agora está em: {status}.{trackingLine}").trim();
  const replacements = {
    customerName: waExtractOrderCustomerName(order),
    orderId: String(orderId || order.id || order.orderId || "").trim() || "---",
    status: String(order.status || order.statusLabel || "Atualizado").trim(),
    trackingCode: String(order.trackingCode || order.codigoRastreio || order.tracking_code || "").trim(),
    trackingLine: waBuildTrackingLine(order),
    storeName: "Ariana Móveis",
  };
  return template.replace(/\{(customerName|orderId|status|trackingCode|trackingLine|storeName)\}/g, (_, key) => replacements[key] || "").replace(/\n{3,}/g, "\n\n").trim();

}

function waBuildMediaPayload({ normalizedNumber, mediaUrl, caption = "", mediaType = "image", fileName = "" }) {
  return {
    number: normalizedNumber,
    mediatype: String(mediaType || "image").trim().toLowerCase(),
    media: String(mediaUrl || "").trim(),
    caption: String(caption || "").trim(),
    fileName: String(fileName || "").trim() || undefined,
  };
}


function waParseAdminNotifyNumbers(settings = {}) {
  return String(settings.adminNotifyNumbers || "")
    .split(",")
    .map((item) => waNormalizeNumber(item, settings.defaultCountryCode || "55"))
    .filter(Boolean);
}

function waExtractSellerPhone(order = {}, defaultCountryCode = "55") {
  const possible = [
    order.sellerPhone,
    order.sellerWhatsapp,
    order.seller?.phone,
    order.seller?.whatsapp,
    order.sellerProfile?.telefone,
    order.sellerProfile?.phone,
    order.vendorPhone,
    order.fabricanteTelefone,
  ];
  for (const item of possible) {
    const n = waNormalizeNumber(item, defaultCountryCode);
    if (n) return n;
  }
  return "";
}

function waBuildOrderChatMessage(orderId, order = {}, message = {}) {
  const senderName = String(message.senderName || "Equipe Ariana Móveis").trim();
  const senderType = String(message.senderType || "admin").trim();
  const customerName = waExtractOrderCustomerName(order);
  const base = senderType === "customer"
    ? `Olá! O cliente ${senderName} enviou uma nova mensagem no pedido ${orderId} da Ariana Móveis.`
    : `Olá, ${customerName}! Você recebeu uma nova mensagem sobre o pedido ${orderId} na Ariana Móveis.`;
  const text = String(message.text || "").trim();
  return `${base}\n\nMensagem: ${text}`.trim();
}

async function waNotifyOrderChatMessage(orderId, order = {}, message = {}, origin = "trigger") {
  const settings = await waGetSettings();
  if (!settings.enabled) return { skipped: true, reason: "integration_disabled" };
  if (!settings.chatNotifyEnabled) return { skipped: true, reason: "chat_notify_disabled" };

  const senderType = String(message.senderType || "").trim() || "customer";
  const defaultCountryCode = settings.defaultCountryCode || "55";
  const targets = new Set();

  if (senderType === "customer") {
    const sellerPhone = waExtractSellerPhone(order, defaultCountryCode);
    if (sellerPhone) targets.add(sellerPhone);
    for (const n of waParseAdminNotifyNumbers(settings)) targets.add(n);
  } else {
    const customerPhone = waExtractOrderPhone(order, defaultCountryCode);
    if (customerPhone) targets.add(customerPhone);
  }

  const numbers = Array.from(targets).filter(Boolean);
  if (!numbers.length) return { skipped: true, reason: "missing_target_phone" };

  const text = waBuildOrderChatMessage(orderId, order, message);
  const results = [];
  for (const number of numbers) {
    const sent = await waSendTextMessage({ number, text, settings });
    results.push({ number, status: sent.status, data: sent.data || null });
  }

  await adminGlobal.firestore().collection("orders").doc(String(orderId)).set({
    chatMeta: {
      lastWhatsappNotifyAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
      lastWhatsappNotifyTargets: numbers,
      lastWhatsappNotifyMessage: text,
      lastWhatsappNotifyOrigin: origin,
    },
  }, { merge: true });

  await writeAuditLog({
    scope: "whatsapp_evolution",
    eventType: "order_chat_whatsapp_sent",
    orderId: String(orderId),
    status: "success",
    request: { origin, senderType, numbers, text },
    response: results,
    metadata: { instanceName: settings.instanceName, apiUrl: settings.apiUrl },
  });

  return { ok: true, numbers, text, results };
}

async function waSendMediaMessage({ number, mediaUrl, caption = "", mediaType = "image", fileName = "", settings = null, delay = 0 }) {
  const axios = require("axios");
  const cfg = settings ? waNormalizeSettings(settings, {}) : await waGetSettings();
  if (!cfg.enabled) throw new Error("Integração WhatsApp desativada.");
  if (!cfg.apiUrl) throw new Error("apiUrl do WhatsApp não configurada.");
  if (!cfg.apiKey) throw new Error("apiKey do WhatsApp não configurada.");
  if (!cfg.instanceName) throw new Error("instanceName do WhatsApp não configurado.");
  const normalizedNumber = waNormalizeNumber(number, cfg.defaultCountryCode || "55");
  if (!normalizedNumber) throw new Error("Número de telefone inválido.");
  if (!String(mediaUrl || "").trim()) throw new Error("URL da mídia não informada.");
  const url = `${cfg.apiUrl}/message/sendMedia/${encodeURIComponent(cfg.instanceName)}`;
  const payload = waBuildMediaPayload({ normalizedNumber, mediaUrl, caption, mediaType, fileName });
  payload.delay = Number(delay || 0) || 0;
  const response = await axios.post(url, payload, {
    headers: {
      "Content-Type": "application/json",
      apikey: cfg.apiKey,
    },
    timeout: 30000,
  });
  return {
    ok: true,
    url,
    number: normalizedNumber,
    instanceName: cfg.instanceName,
    data: response.data,
    status: response.status,
    payload: auditRedact(payload),
  };
}

async function waSendTextMessage({ number, text, settings = null, delay = 0 }) {
  const axios = require("axios");
  const cfg = settings ? waNormalizeSettings(settings, {}) : await waGetSettings();
  if (!cfg.enabled) throw new Error("Integração WhatsApp desativada.");
  if (!cfg.apiUrl) throw new Error("apiUrl do WhatsApp não configurada.");
  if (!cfg.apiKey) throw new Error("apiKey do WhatsApp não configurada.");
  if (!cfg.instanceName) throw new Error("instanceName do WhatsApp não configurado.");
  const normalizedNumber = waNormalizeNumber(number, cfg.defaultCountryCode || "55");
  if (!normalizedNumber) throw new Error("Número de telefone inválido.");
  const url = `${cfg.apiUrl}/message/sendText/${encodeURIComponent(cfg.instanceName)}`;
  const response = await axios.post(url, {
    number: normalizedNumber,
    text: String(text || "").trim(),
    delay: Number(delay || 0) || 0,
    linkPreview: false,
  }, {
    headers: {
      "Content-Type": "application/json",
      apikey: cfg.apiKey,
    },
    timeout: 30000,
  });
  return {
    ok: true,
    url,
    number: normalizedNumber,
    instanceName: cfg.instanceName,
    data: response.data,
    status: response.status,
  };
}

async function waSyncWebhook(settings = null) {
  const axios = require("axios");
  const cfg = settings ? waNormalizeSettings(settings, {}) : await waGetSettings();
  if (!cfg.apiUrl) throw new Error("apiUrl do WhatsApp não configurada.");
  if (!cfg.apiKey) throw new Error("apiKey do WhatsApp não configurada.");
  if (!cfg.instanceName) throw new Error("instanceName do WhatsApp não configurado.");
  if (!cfg.webhookUrl) throw new Error("webhookUrl não configurada.");

  const url = `${cfg.apiUrl}/webhook/set/${encodeURIComponent(cfg.instanceName)}`;
  const body = {
    enabled: cfg.enabled === true,
    url: cfg.webhookUrl,
    webhookByEvents: cfg.webhookByEvents === true,
    webhookBase64: cfg.webhookBase64 === true,
    events: Array.isArray(cfg.webhookEvents) && cfg.webhookEvents.length ? cfg.webhookEvents : [...WHATSAPP_WEBHOOK_EVENTS_DEFAULT],
  };

  const response = await axios.post(url, body, {
    headers: {
      "Content-Type": "application/json",
      apikey: cfg.apiKey,
    },
    timeout: 30000,
  });

  await waSettingsRef().set({
    lastWebhookSyncAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
    lastWebhookSyncResponse: auditRedact(response.data || null),
  }, { merge: true });

  return { ok: true, url, body, data: response.data, status: response.status };
}

async function waMaybeNotifyOrderStatusChange(orderId, before = {}, after = {}, origin = "trigger") {
  const prevStatus = String(before?.status || "").trim();
  const nextStatus = String(after?.status || "").trim();
  if (!nextStatus) return { skipped: true, reason: "missing_status" };
  if (prevStatus === nextStatus) return { skipped: true, reason: "status_unchanged" };

  const settings = await waGetSettings();
  if (!settings.enabled) return { skipped: true, reason: "integration_disabled" };
  if (!settings.autoNotifyOrderStatus) return { skipped: true, reason: "auto_notify_disabled" };

  const alreadyNotified = String(after?.whatsappNotification?.lastStatusNotified || "").trim();
  if (alreadyNotified === nextStatus) return { skipped: true, reason: "already_notified" };

  const number = waExtractOrderPhone(after, settings.defaultCountryCode || "55");
  if (!number) {
    await adminGlobal.firestore().collection("orders").doc(String(orderId)).set({
      whatsappNotification: {
        lastAttemptAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
        lastStatusNotified: null,
        lastError: "Telefone do cliente não encontrado.",
        origin,
      },
    }, { merge: true });
    return { skipped: true, reason: "missing_phone" };
  }

  const text = waBuildOrderStatusMessage(orderId, after, settings);
  const sent = await waSendTextMessage({ number, text, settings });

  await adminGlobal.firestore().collection("orders").doc(String(orderId)).set({
    whatsappNotification: {
      lastAttemptAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
      lastStatusNotified: nextStatus,
      lastMessage: text,
      lastPhone: number,
      lastError: null,
      lastResponse: auditRedact(sent.data || null),
      origin,
    },
  }, { merge: true });

  await writeAuditLog({
    scope: "whatsapp_evolution",
    eventType: "order_status_whatsapp_sent",
    orderId: String(orderId),
    status: "success",
    request: { number, text, origin },
    response: sent.data || null,
    metadata: { instanceName: settings.instanceName, apiUrl: settings.apiUrl },
  });

  return { ok: true, number, text, sent };
}

function waParseIncomingWebhook(body = {}) {
  const payload = body?.data || body?.message || body || {};
  const key = payload?.key || body?.key || {};
  const message = payload?.message || body?.message || {};
  const text =
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    body?.text ||
    "";
  const remoteJid = key?.remoteJid || payload?.key?.remoteJid || body?.remoteJid || "";
  const number = waDigits(String(remoteJid).split("@")[0] || body?.from || "");
  const pushName = payload?.pushName || body?.pushName || body?.sender?.pushName || null;
  const fromMe = key?.fromMe === true || body?.fromMe === true;
  const event = String(body?.event || body?.type || "").trim() || null;
  return { event, remoteJid, number, pushName, fromMe, text: String(text || "").trim(), raw: body };
}

async function waPersistWebhook(body = {}) {
  const parsed = waParseIncomingWebhook(body);
  const now = adminGlobal.firestore.FieldValue.serverTimestamp();
  const logRef = adminGlobal.firestore().collection("whatsapp_webhooks").doc();
  await logRef.set({
    createdAt: now,
    event: parsed.event || null,
    remoteJid: parsed.remoteJid || null,
    number: parsed.number || null,
    pushName: parsed.pushName || null,
    fromMe: parsed.fromMe === true,
    text: parsed.text || null,
    payload: auditRedact(body || null),
  }, { merge: true });

  if ((parsed.event === "MESSAGES_UPSERT" || !parsed.event) && !parsed.fromMe && parsed.text) {
    await adminGlobal.firestore().collection("atendimentos").add({
      protocolo: `WA-${Date.now()}`,
      nome: parsed.pushName || parsed.number || "WhatsApp",
      email: null,
      tipo: "WhatsApp",
      status: "Novo",
      telefone: parsed.number || null,
      mensagem: parsed.text,
      origem: "evolution_webhook",
      remoteJid: parsed.remoteJid || null,
      data: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  return parsed;
}

function sanitizeIdPart(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "item";
}

async function upsertOperationalAlert(data = {}) {
  try {
    const manufacturer = data.manufacturer ? String(data.manufacturer) : "global";
    const type = data.type ? String(data.type) : "generic";
    const entityKey = data.entityKey ? String(data.entityKey) : `${manufacturer}_${type}`;
    const alertId = `${sanitizeIdPart(type)}__${sanitizeIdPart(entityKey)}`;
    const now = adminGlobal.firestore.FieldValue.serverTimestamp();
    const payload = {
      type,
      severity: data.severity || "medium",
      status: data.status || "open",
      title: data.title || "Alerta operacional",
      message: data.message || null,
      manufacturer: data.manufacturer || null,
      orderId: data.orderId || null,
      queueId: data.queueId || null,
      entityKey,
      metadata: auditRedact(data.metadata || null),
      buildId: BUILD_ID,
      lastSeenAt: now,
      updatedAt: now,
      resolvedAt: data.status === "resolved" ? now : null,
    };
    const ref = adminGlobal.firestore().collection(OPERATIONAL_ALERT_COLLECTION).doc(alertId);
    const snap = await ref.get();
    if (snap.exists) {
      payload.count = Number((snap.data() || {}).count || 1) + 1;
      payload.firstSeenAt = snap.data()?.firstSeenAt || now;
    } else {
      payload.count = 1;
      payload.firstSeenAt = now;
      payload.createdAt = now;
    }
    await ref.set(payload, { merge: true });
    return { id: alertId, ...payload };
  } catch (e) {
    console.error('[alerts] upsert failed:', e?.message || e);
    return null;
  }
}

async function resolveOperationalAlert(type, entityKey) {
  try {
    const alertId = `${sanitizeIdPart(type)}__${sanitizeIdPart(entityKey)}`;
    await adminGlobal.firestore().collection(OPERATIONAL_ALERT_COLLECTION).doc(alertId).set({
      status: 'resolved',
      resolvedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
      updatedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
      lastSeenAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
      buildId: BUILD_ID,
    }, { merge: true });
  } catch (e) {
    console.error('[alerts] resolve failed:', e?.message || e);
  }
}

async function scanOperationalAlerts(db) {
  const findings = [];
  const queueSnap = await db.collection('manufacturer_dispatch_queue').limit(200).get();
  for (const doc of queueSnap.docs) {
    const row = doc.data() || {};
    const status = String(row.status || '').toLowerCase();
    const attempts = Number(row.attempts || 0);
    const manufacturer = row.manufacturer || null;
    const orderId = row.orderId || null;
    if (status === 'dead_letter') {
      const alert = await upsertOperationalAlert({
        type: 'dispatch_dead_letter',
        severity: 'critical',
        manufacturer,
        orderId,
        queueId: doc.id,
        entityKey: doc.id,
        title: 'Pedido caiu em dead letter',
        message: `O pedido ${orderId || doc.id} esgotou as tentativas de envio ao fabricante.`,
        metadata: row,
      });
      if (alert) findings.push(alert);
      continue;
    }
    if (['pending', 'retrying', 'retry_processing'].includes(status) && attempts >= 3) {
      const alert = await upsertOperationalAlert({
        type: 'dispatch_retry_pressure',
        severity: attempts >= 5 ? 'high' : 'medium',
        manufacturer,
        orderId,
        queueId: doc.id,
        entityKey: doc.id,
        title: 'Fila de reenvio com muitas tentativas',
        message: `O pedido ${orderId || doc.id} já acumula ${attempts} tentativas de envio ao fabricante.`,
        metadata: row,
      });
      if (alert) findings.push(alert);
    }
  }

  const orderSnap = await db.collection('orders').limit(200).get();
  for (const doc of orderSnap.docs) {
    const row = doc.data() || {};
    const integ = String(row.status_integracao || '').toLowerCase();
    const dispatchStatus = String(row.manufacturerDispatch?.status || '').toLowerCase();
    const manufacturer = row.manufacturer || row.fabricante || row.vendedor_id || null;
    if (['erro_envio_fabricante', 'fila_erro_fabricante'].includes(integ) || dispatchStatus === 'error') {
      const alert = await upsertOperationalAlert({
        type: 'order_dispatch_error',
        severity: 'high',
        manufacturer,
        orderId: doc.id,
        queueId: row.manufacturerDispatch?.queueId || null,
        entityKey: doc.id,
        title: 'Pedido com erro de integração',
        message: `O pedido ${doc.id} está com falha no envio ao fabricante.`,
        metadata: {
          status_integracao: row.status_integracao || null,
          manufacturerDispatch: row.manufacturerDispatch || null,
        },
      });
      if (alert) findings.push(alert);
    }
  }

  const since = Date.now() - (6 * 60 * 60 * 1000);
  const auditSnap = await db.collection(INTEGRATION_AUDIT_COLLECTION).orderBy('createdAt', 'desc').limit(300).get();
  const stats = {};
  for (const doc of auditSnap.docs) {
    const row = doc.data() || {};
    const manufacturer = String(row.manufacturer || 'global');
    const ts = row.createdAt?.toMillis ? row.createdAt.toMillis() : null;
    if (ts && ts < since) continue;
    stats[manufacturer] = stats[manufacturer] || { errors: 0, success: 0 };
    const eventType = String(row.eventType || '');
    const status = String(row.status || '').toLowerCase();
    const statusCode = Number(row.statusCode || 0);
    if (eventType === 'manufacturer_dispatch_http') {
      if (status === 'success' || (statusCode >= 200 && statusCode < 300)) stats[manufacturer].success += 1;
      else stats[manufacturer].errors += 1;
    }
  }
  for (const [manufacturer, stat] of Object.entries(stats)) {
    if (stat.errors >= 3 && stat.success === 0) {
      const alert = await upsertOperationalAlert({
        type: 'manufacturer_outage',
        severity: stat.errors >= 5 ? 'critical' : 'high',
        manufacturer,
        entityKey: manufacturer,
        title: 'Possível indisponibilidade do fabricante',
        message: `Foram detectadas ${stat.errors} falhas recentes sem sucesso para ${manufacturer}.`,
        metadata: stat,
      });
      if (alert) findings.push(alert);
    }
  }

  return findings;
}


function auditRedact(value, depth = 0) {
  if (depth > 6) return "[max-depth]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => auditRedact(v, depth + 1));
  if (typeof value !== "object") return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const key = String(k).toLowerCase();
    if (["authorization", "token", "api_token", "apitoken", "password", "secret", "certificate", "certificate_secret", "sandbox_token", "webhook_token", "client_secret", "access_token", "refresh_token", "pfx", "privatekey", "private_key"].includes(key) || key.includes("token") || key.includes("secret") || key.includes("password") || key.includes("certificate") || key.includes("private_key")) {
      out[k] = "[redacted]";
      continue;
    }
    out[k] = auditRedact(v, depth + 1);
  }
  return out;
}

function auditChangedKeys(before, after, prefix = "") {
  const keys = new Set([
    ...Object.keys(before && typeof before === "object" ? before : {}),
    ...Object.keys(after && typeof after === "object" ? after : {}),
  ]);
  const changes = [];
  for (const key of keys) {
    const b = before ? before[key] : undefined;
    const a = after ? after[key] : undefined;
    const p = prefix ? `${prefix}.${key}` : key;
    const bothObjects = b && a && typeof b === "object" && typeof a === "object" && !Array.isArray(b) && !Array.isArray(a);
    if (bothObjects) {
      changes.push(...auditChangedKeys(b, a, p));
      continue;
    }
    if (JSON.stringify(b) !== JSON.stringify(a)) changes.push(p);
  }
  return changes.slice(0, 200);
}

async function writeAuditLog(entry = {}) {
  try {
    const payload = {
      scope: entry.scope || "manufacturer_integration",
      eventType: entry.eventType || "unspecified",
      orderId: entry.orderId ? String(entry.orderId) : null,
      manufacturer: entry.manufacturer ? String(entry.manufacturer) : null,
      integrationId: entry.integrationId ? String(entry.integrationId) : null,
      queueId: entry.queueId ? String(entry.queueId) : null,
      status: entry.status || null,
      statusCode: Number.isFinite(Number(entry.statusCode)) ? Number(entry.statusCode) : null,
      message: entry.message ? String(entry.message) : null,
      changedKeys: Array.isArray(entry.changedKeys) ? entry.changedKeys.slice(0, 200) : [],
      request: auditRedact(entry.request || null),
      response: auditRedact(entry.response || null),
      metadata: auditRedact(entry.metadata || null),
      buildId: BUILD_ID,
      createdAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
    };
    await adminGlobal.firestore().collection(INTEGRATION_AUDIT_COLLECTION).add(payload);
  } catch (e) {
    console.error("[audit] failed to write log:", e?.message || e);
  }
}


// ---------- LAZY INIT (evita timeout no deploy) ----------
let _app = null;

function buildApp() {
  const admin = require("firebase-admin");
  const sgMail = require("@sendgrid/mail");
  const express = require("express");
  const cors = require("cors");
  const axios = require("axios");
  const crypto = require("crypto");
  const multer = require("multer");

  if (admin.apps.length === 0) admin.initializeApp();

  const app = express();

  const corsOptions = {
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  };

  app.use(cors(corsOptions));
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }
  });

  const db = admin.firestore();

  app.get("/api/admin/stats", async (_req, res) => {
    try {
      const orders = await db.collection("orders").get();
      const users = await db.collection("users").get();

      let faturamentoTotal = 0;
      let pedidosPendentes = 0;

      orders.forEach((doc) => {
        const row = doc.data() || {};
        const total = Number(row.total || row.totalPrice || row.amount || 0) || 0;
        faturamentoTotal += total;

        const status = String(row.status || "").toLowerCase();
        if (["pending", "pendente", "aguardando pagamento", "pending_payment"].includes(status)) {
          pedidosPendentes += 1;
        }
      });

      res.json({
        faturamentoTotal,
        pedidosPendentes,
        totalClientes: users.size || 0,
        totalPedidos: orders.size || 0
      });
    } catch (err) {
      console.error("[admin/stats]", err);
      res.status(500).json({ error: "Erro ao carregar estatísticas" });
    }
  });

  // --- SendGrid / Reset de senha (Seller) ---
  const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || "";
  const EMAIL_FROM = process.env.EMAIL_FROM || "";
  const RESET_CONTINUE_URL =
    process.env.RESET_CONTINUE_URL ||
    "https://ariana-moveis-final.web.app/login_seller.html";

  if (SENDGRID_API_KEY) {
    try {
      sgMail.setApiKey(SENDGRID_API_KEY);
    } catch (e) {
      console.warn("[sendgrid] Falha ao setar API key:", e);
    }
  }


  function publicBaseUrl(req) {
    const proto = (req.get("x-forwarded-proto") || "https").split(",")[0].trim();
    const host = (req.get("x-forwarded-host") || req.get("host")).split(",")[0].trim();
    return `${proto}://${host}`;
  }

  async function mergeOrder(orderId, patch) {
    if (!orderId) return;
    const id = String(orderId);

    const payload = { ...patch, updatedAt: admin.firestore.FieldValue.serverTimestamp() };

    // Coleção oficial única de pedidos
    await db.collection("orders").doc(id).set(payload, { merge: true });
  }

  // --- TRATAMENTO DE ROTAS (mantido) ---
  app.use((req, _res, next) => {
    if (req.url.startsWith("/api")) req.url = req.url.replace("/api", "");
    next();
  });


  // ================= MONGO ROUTES MERGED (server.js unificado) =================
  function snapData(snap) {
    if (!snap || !snap.exists) return null;
    const data = snap.data ? (snap.data() || {}) : {};
    return { id: snap.id || data.id || null, ...data };
  }

  async function listCollection(name, orderField = "createdAt", direction = "desc") {
    try {
      const snap = await db.collection(name).orderBy(orderField, direction).get();
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    } catch (_) {
      const snap = await db.collection(name).get();
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    }
  }

  function sellerCollection() { return db.collection("sellers"); }
  function productCollection() { return db.collection("products"); }
  function bannerCollection() { return db.collection("banners"); }
  function categoryCollection() { return db.collection("categories"); }
  function settingsCollection() { return db.collection("settings"); }
  function supportCollection() { return db.collection("support_tickets"); }
  function ordersCollection() { return db.collection("orders"); }

  
  function normalizeImageEntry(img, index = 0) {
    if (!img) return null;

    if (typeof img === "string") {
      const url = String(img).trim();
      if (!url) return null;
      return {
        url,
        name: `imagem-${index + 1}.jpg`,
        path: "",
        isMain: index === 0,
      };
    }

    const url = String(img.url || img.imageUrl || img.downloadURL || img.src || "").trim();
    if (!url) return null;

    return {
      url,
      name: String(img.name || `imagem-${index + 1}.jpg`).trim(),
      path: String(img.path || img.fullPath || "").trim(),
      isMain: Boolean(img.isMain),
      contentType: String(img.contentType || "").trim() || undefined,
    };
  }

  function normalizeProductImages(body = {}) {
    const rawImages = Array.isArray(body.images)
      ? body.images
      : (body.images && typeof body.images === "object" ? Object.values(body.images) : []);

    let images = rawImages
      .map((img, index) => normalizeImageEntry(img, index))
      .filter(Boolean);

    if (!images.length) {
      const fallback = String(
        body.mainImageUrl ||
        body.imageUrl ||
        body.image ||
        ""
      ).trim();

      if (fallback) {
        images = [{
          url: fallback,
          name: "imagem-principal.jpg",
          path: String(body.mainImagePath || "").trim(),
          isMain: true,
        }];
      }
    }

    if (images.length && !images.some((img) => img.isMain)) {
      images[0].isMain = true;
    }

    const mainImage = images.find((img) => img.isMain) || images[0] || null;

    return {
      images,
      imageUrls: images.map((img) => img.url).filter(Boolean),
      imagePaths: images.map((img) => img.path).filter(Boolean),
      mainImageUrl: mainImage ? mainImage.url : "",
      mainImagePath: mainImage ? String(mainImage.path || "").trim() : "",
      imageUrl: mainImage ? mainImage.url : "",
      image: mainImage ? mainImage.url : "",
    };
  }

  function normalizeBannerSlotKey(value) {
    return String(value || "").trim().toLowerCase();
  }

  function resolveHeaderCategoryBanner(banners = []) {
    const candidates = [
      "header_category",
      "header-category",
      "headerCategory",
      "categoria_header",
      "header_categoria",
      "header-category-banner",
    ].map(normalizeBannerSlotKey);

    return banners.find((b) => {
      const keys = [b?.id, b?.slot, b?.slotId, b?.key].map(normalizeBannerSlotKey);
      return keys.some((k) => candidates.includes(k));
    }) || null;
  }


  function normalizeProductPayload(body = {}) {
    const normalizedImages = normalizeProductImages(body);
    const payload = {
      name: body.name || body.nome || "",
      sku: body.sku || body.codigo || "",
      price: Number(body.price ?? body.preco ?? 0) || 0,
      stock: Number(body.stock ?? body.estoque ?? 0) || 0,
      category: body.category || body.categoria || "",
      description: body.description || body.descricao || "",
      ...normalizedImages,
      pesoKg: Number(body.pesoKg ?? body.weight ?? 0) || 0,
      comprimento: Number(body.comprimento ?? body.length ?? 0) || 0,
      largura: Number(body.largura ?? body.width ?? 0) || 0,
      altura: Number(body.altura ?? body.height ?? 0) || 0,
      sellerId: String(body.sellerId || body.seller_id || body.partner_request_id || "").trim() || null,
      active: body.active !== false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (!payload.createdAt) payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
    return payload;
  }

  function normalizeSellerPayload(body = {}, existing = {}) {
    return {
      name: body.name || body.nome || existing.name || "",
      factoryName: body.factoryName || body.nomeFantasia || existing.factoryName || "",
      email: String(body.email || existing.email || "").trim().toLowerCase(),
      phone: body.phone || body.telefone || existing.phone || "",
      whatsapp: body.whatsapp || existing.whatsapp || "",
      cnpj: body.cnpj || existing.cnpj || "",
      password: body.password || existing.password || "",
      status: body.status || existing.status || "pending_onboarding",
      active: body.active !== false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: existing.createdAt || admin.firestore.FieldValue.serverTimestamp(),
    };
  }

  function normalizeBannerPayload(item = {}) {
    const id = String(item.id || item.slot || item.slotId || item.key || "").trim();
    const clean = { ...(item || {}) };

    delete clean._id;
    delete clean.id;
    delete clean.slot;
    delete clean.slotId;
    delete clean.key;

    return {
      ...clean,
      id,
      slot: id,
      active: item.active !== false,
      imageUrl: String(item.imageUrl || item.url || item.image || "").trim(),
      linkUrl: String(item.linkUrl || item.link || "").trim(),
      alt: String(item.alt || item.title || "").trim(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
  }

  function toDataUrlFromBody(body = {}) {
    const direct =
      body.imageBase64 ||
      body.base64 ||
      body.image ||
      body.fileBase64 ||
      body.dataUrl ||
      "";

    if (!direct) return "";
    const raw = String(direct).trim();

    if (raw.startsWith("data:")) return raw;

    const mime = String(body.mimeType || body.contentType || "image/png").trim() || "image/png";
    return `data:${mime};base64,${raw}`;
  }

  app.get("/", async (_req, res) => {
    res.json({
      ok: true,
      service: "Ariana Móveis API",
      mode: "mongo_unified",
      buildId: BUILD_ID,
      message: "Servidor rodando com sucesso",
    });
  });

  app.get("/seller/dashboard", async (_req, res) => {
    try {
      const products = await listCollection("products");
      const orders = await listCollection("orders");
      const totalProdutos = products.length;
      const pedidosPendentes = orders.filter((o) => ["pending", "pendente", "pending_payment"].includes(String(o.status || "").toLowerCase())).length;
      const vendasTotal = orders.reduce((sum, o) => sum + (Number(o.total || o.totalPrice || 0) || 0), 0);
      res.json({
        totalProdutos,
        vendasHoje: 0,
        pedidosPendentes,
        vendasTotal,
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Erro no dashboard" });
    }
  });

  app.get("/seller/extrato", async (_req, res) => {
    try {
      const orders = await listCollection("orders");
      const extrato = orders.map((o) => {
        const bruto = Number(o.total || o.totalPrice || 0) || 0;
        const comissao = bruto * 0.12;
        const etiqueta = 0;
        return {
          id: o.id,
          gross: bruto,
          fee: comissao,
          label: etiqueta,
          net: bruto - comissao - etiqueta,
        };
      });
      res.json(extrato);
    } catch (err) {
      res.status(500).json({ error: "Erro ao processar extrato" });
    }
  });

  app.get("/seller/products", async (_req, res) => {
    try {
      const products = await listCollection("products");
      res.json(products);
    } catch (err) {
      res.status(500).json({ error: err.message || "Erro ao listar produtos" });
    }
  });

  app.post("/seller/products", async (req, res) => {
    try {
      const ref = productCollection().doc();
      const payload = normalizeProductPayload(req.body || {});
      payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
      await ref.set({ id: ref.id, ...payload }, { merge: true });
      const snap = await ref.get();
      res.status(201).json({ ok: true, product: snapData(snap) });
    } catch (err) {
      res.status(400).json({ error: err.message || "Erro ao criar produto" });
    }
  });

  app.get("/seller/products/:id", async (req, res) => {
    try {
      const snap = await productCollection().doc(String(req.params.id)).get();
      const product = snapData(snap);
      if (!product) return res.status(404).json({ error: "Produto não encontrado" });
      res.json(product);
    } catch (err) {
      res.status(500).json({ error: err.message || "Erro ao buscar produto" });
    }
  });

  app.put("/seller/products/:id", async (req, res) => {
    try {
      const ref = productCollection().doc(String(req.params.id));
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "Produto não encontrado" });
      const existing = snap.data() || {};
      const payload = { ...existing, ...normalizeProductPayload({ ...existing, ...(req.body || {}) }) };
      await ref.set({ ...payload, id: ref.id }, { merge: true });
      const updated = await ref.get();
      res.json({ ok: true, product: snapData(updated) });
    } catch (err) {
      res.status(400).json({ error: err.message || "Erro ao atualizar produto" });
    }
  });

  app.delete("/seller/products/:id", async (req, res) => {
    try {
      await productCollection().doc(String(req.params.id)).delete();
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message || "Erro ao excluir produto" });
    }
  });

  // Aliases públicos para o front
  app.get("/products", async (req, res) => req.url && app._router ? app.handle({ ...req, url: `/seller/products`, method: "GET" }, res) : res.status(500).json({ error: "router_unavailable" }));
  app.post("/products", async (req, res) => req.url && app._router ? app.handle({ ...req, url: `/seller/products`, method: "POST" }, res) : res.status(500).json({ error: "router_unavailable" }));
  app.get("/products/:id", async (req, res) => req.url && app._router ? app.handle({ ...req, url: `/seller/products/${req.params.id}`, method: "GET", params: req.params }, res) : res.status(500).json({ error: "router_unavailable" }));
  app.put("/products/:id", async (req, res) => req.url && app._router ? app.handle({ ...req, url: `/seller/products/${req.params.id}`, method: "PUT", params: req.params }, res) : res.status(500).json({ error: "router_unavailable" }));
  app.delete("/products/:id", async (req, res) => req.url && app._router ? app.handle({ ...req, url: `/seller/products/${req.params.id}`, method: "DELETE", params: req.params }, res) : res.status(500).json({ error: "router_unavailable" }));

  app.get("/seller/orders", async (_req, res) => {
    try {
      const orders = await listCollection("orders");
      res.json(orders);
    } catch (err) {
      res.status(500).json({ error: "Erro ao buscar pedidos" });
    }
  });

  app.get("/seller/orders/:id", async (req, res) => {
    try {
      const snap = await ordersCollection().doc(String(req.params.id)).get();
      const order = snapData(snap);
      if (!order) return res.status(404).json({ error: "Pedido não encontrado" });
      res.json(order);
    } catch (err) {
      res.status(500).json({ error: err.message || "Erro ao buscar pedido" });
    }
  });

  app.post("/seller/orders/:id/ship", async (req, res) => {
    try {
      const { carrier, trackingCode } = req.body || {};
      await ordersCollection().doc(String(req.params.id)).set({
        status: "shipped",
        carrier: carrier || null,
        trackingCode: trackingCode || null,
        shippedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message || "Erro ao enviar pedido" });
    }
  });

  app.post("/chat", async (req, res) => {
    try {
      const { message = "" } = req.body || {};
      let resposta = "Desculpe, não entendi.";
      if (String(message).includes("1")) resposta = "Nossos móveis têm 1 ano de garantia.";
      res.json({ content: resposta });
    } catch (_err) {
      res.json({ content: "Erro no bot" });
    }
  });

  app.get("/seller/partner-requests", async (_req, res) => {
    try {
      const sellers = await listCollection("sellers");
      res.json(sellers);
    } catch (err) {
      res.status(500).json({ error: err.message || "Erro ao listar sellers" });
    }
  });

  app.patch("/seller/partner-requests/:id/status", async (req, res) => {
    try {
      const ref = sellerCollection().doc(String(req.params.id));
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "Seller não encontrado" });

      await ref.set({
        status: req.body?.status,
        active: req.body?.active,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      const updated = await ref.get();
      res.json({ ok: true, seller: snapData(updated) });
    } catch (err) {
      res.status(400).json({ error: err.message || "Erro ao atualizar seller" });
    }
  });

  app.post("/seller/partner-request", async (req, res) => {
    try {
      const ref = sellerCollection().doc();
      const payload = normalizeSellerPayload(req.body || {}, {});
      await ref.set({ id: ref.id, ...payload }, { merge: true });
      res.status(201).json({ ok: true, partner_request_id: ref.id, seller: { id: ref.id, ...payload } });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message || "Erro ao criar solicitação" });
    }
  });

  app.post("/seller/complete-onboarding", async (req, res) => {
    try {
      const sellerId = String(req.body?.sellerId || req.body?.partner_request_id || req.body?.id || "").trim();
      if (!sellerId) return res.status(400).json({ ok: false, error: "sellerId obrigatório" });
      const ref = sellerCollection().doc(sellerId);
      const snap = await ref.get();
      const existing = snap.exists ? (snap.data() || {}) : {};
      const payload = {
        ...normalizeSellerPayload({ ...existing, ...(req.body || {}) }, existing),
        status: req.body?.status || "approved",
        onboardingCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      await ref.set({ id: ref.id, ...payload }, { merge: true });
      const updated = await ref.get();
      res.json({ ok: true, seller: snapData(updated) });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message || "Erro no onboarding" });
    }
  });

  app.post("/seller/auth/login", async (req, res) => {
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      const password = String(req.body?.password || "");
      const snap = await sellerCollection().where("email", "==", email).limit(1).get();
      if (snap.empty) return res.status(401).json({ message: "Credenciais inválidas" });
      const sellerDoc = snap.docs[0];
      const seller = sellerDoc.data() || {};
      if (String(seller.password || "") !== password) {
        return res.status(401).json({ message: "Credenciais inválidas" });
      }
      res.json({ token: "token_" + sellerDoc.id, seller: { id: sellerDoc.id, ...seller } });
    } catch (err) {
      res.status(500).json({ error: err.message || "Erro no login" });
    }
  });

  app.get("/seller/me", async (_req, res) => {
    try {
      const sellers = await listCollection("sellers", "createdAt", "asc");
      res.json(sellers[0] || { factoryName: "Seller Ariana" });
    } catch (err) {
      res.status(500).json({ error: err.message || "Erro ao buscar seller" });
    }
  });

  app.put("/seller/update", async (req, res) => {
    try {
      const sellers = await listCollection("sellers", "createdAt", "asc");
      const first = sellers[0];
      if (!first) return res.status(404).json({ error: "Seller não encontrado" });
      const ref = sellerCollection().doc(String(first.id));
      const payload = normalizeSellerPayload({ ...(first || {}), ...(req.body || {}) }, first || {});
      await ref.set({ id: ref.id, ...payload }, { merge: true });
      const updated = await ref.get();
      res.json({ ok: true, seller: snapData(updated) });
    } catch (err) {
      res.status(400).json({ error: err.message || "Erro ao atualizar seller" });
    }
  });

  app.get("/seller/:id", async (req, res) => {
    try {
      const snap = await sellerCollection().doc(String(req.params.id)).get();
      const seller = snapData(snap);
      if (!seller) return res.status(404).json({ error: "Seller não encontrado" });
      res.json(seller);
    } catch (err) {
      res.status(500).json({ error: err.message || "Erro ao buscar seller" });
    }
  });

  app.get("/seller/support", async (_req, res) => {
    try {
      const tickets = await listCollection("support_tickets");
      res.json(tickets);
    } catch (err) {
      res.status(500).json({ error: err.message || "Erro ao buscar atendimentos" });
    }
  });

  app.patch("/seller/support/:id/read", async (req, res) => {
    try {
      await supportCollection().doc(String(req.params.id)).set({
        status: "Respondido",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message || "Erro ao atualizar ticket" });
    }
  });

  app.get(["/categories", "/api/categories"], async (_req, res) => {
    try {
      const cats = await listCollection("categories", "name", "asc");
      res.json(cats);
    } catch (err) {
      res.status(500).json({ error: err.message || "Erro ao buscar categorias" });
    }
  });

  app.get(["/banners", "/api/banners"], async (req, res) => {
    try {
      const banners = await listCollection("banners");
      const slot = String(req.query?.slot || "").trim();

      if (slot) {
        const found = banners.find((b) => {
          const keys = [b?.id, b?.slot, b?.slotId, b?.key];
          return keys.some((value) => String(value || "").trim() === slot);
        });
        return res.json(found || null);
      }

      const keyed = Object.fromEntries(
        banners
          .map((b) => [String(b?.id || b?.slot || b?.slotId || b?.key || "").trim(), b])
          .filter(([k]) => !!k)
      );

      res.json({
        items: banners,
        banners,
        keyed,
        bySlot: keyed
      });
    } catch (err) {
      console.error("[banners:get]", err);
      res.status(500).json({ error: err.message || "Erro ao buscar banners" });
    }
  });

  app.post(["/banners", "/api/banners"], async (req, res) => {
    try {
      const payload = req.body || {};
      const entries = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.banners)
          ? payload.banners
          : Object.values(payload);

      for (const item of entries) {
        const normalized = normalizeBannerPayload(item);
        if (!normalized.id) continue;
        await bannerCollection().doc(normalized.id).set(normalized, { merge: true });
      }

      res.json({ ok: true });
    } catch (err) {
      console.error("[banners:post]", err);
      res.status(400).json({ error: err.message || "Erro ao salvar banners" });
    }
  });

  app.post(["/banners/bulk", "/api/banners/bulk"], async (req, res) => {
    try {
      const banners = Array.isArray(req.body?.banners)
        ? req.body.banners
        : Array.isArray(req.body)
          ? req.body
          : [];

      for (const item of banners) {
        const normalized = normalizeBannerPayload(item);
        if (!normalized.id) continue;
        await bannerCollection().doc(normalized.id).set(normalized, { merge: true });
      }

      res.json({ ok: true });
    } catch (err) {
      console.error("[banners:bulk]", err);
      res.status(400).json({ error: err.message || "Erro ao salvar banners em lote" });
    }
  });

  app.post(["/upload", "/api/upload", "/banners/upload", "/api/banners/upload"], upload.single("file"), async (req, res) => {
    try {
      let dataUrl = "";

      if (req.file && req.file.buffer) {
        const mime = String(req.file.mimetype || "image/png").trim() || "image/png";
        const base64 = req.file.buffer.toString("base64");
        dataUrl = `data:${mime};base64,${base64}`;
      } else {
        dataUrl = toDataUrlFromBody(req.body || {});
      }

      if (!dataUrl) {
        return res.status(400).json({ error: "Arquivo ou imageBase64 obrigatório" });
      }

      return res.json({
        ok: true,
        url: dataUrl,
        imageUrl: dataUrl,
        filename: (req.file && req.file.originalname) ? req.file.originalname : null
      });
    } catch (err) {
      console.error("[banners:upload]", err);
      res.status(400).json({ error: err.message || "Erro no upload do banner" });
    }
  });



  app.get([
    "/banners/:id",
    "/api/banners/:id",
    "/banner-slots/:id",
    "/api/banner-slots/:id",
    "/index/banners/:id",
    "/api/index/banners/:id",
    "/home/banners/:id",
    "/api/home/banners/:id"
  ], async (req, res) => {
    try {
      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ error: "ID do banner obrigatório" });

      const directSnap = await bannerCollection().doc(id).get();
      const directData = snapData(directSnap);
      if (directData) return res.json(directData);

      const banners = await listCollection("banners");
      const found = banners.find((b) => {
        const keys = [b?.id, b?.slot, b?.slotId, b?.key];
        return keys.some((value) => String(value || "").trim() === id);
      });

      if (!found) return res.status(404).json({ error: "Banner não encontrado" });
      return res.json(found);
    } catch (err) {
      console.error("[banners:getById]", err);
      res.status(500).json({ error: err.message || "Erro ao buscar banner" });
    }
  });

  app.get([
    "/banner-slots",
    "/api/banner-slots",
    "/index/banners",
    "/api/index/banners",
    "/home/banners",
    "/api/home/banners"
  ], async (req, res) => {
    try {
      const banners = await listCollection("banners");
      const slot = String(req.query?.slot || "").trim();

      if (slot) {
        const found = banners.find((b) => {
          const keys = [b?.id, b?.slot, b?.slotId, b?.key];
          return keys.some((value) => String(value || "").trim() === slot);
        });
        return res.json(found || null);
      }

      return res.json(banners);
    } catch (err) {
      console.error("[banner-slots:get]", err);
      res.status(500).json({ error: err.message || "Erro ao buscar banner slots" });
    }
  });


  app.get([
    "/header_category_banner",
    "/api/header_category_banner",
    "/home/header_category_banner",
    "/api/home/header_category_banner"
  ], async (_req, res) => {
    try {
      const banners = await listCollection("banners");
      return res.json(resolveHeaderCategoryBanner(banners));
    } catch (err) {
      console.error("[header_category_banner:get]", err);
      return res.status(500).json({ error: err.message || "Erro ao buscar banner de header de categoria" });
    }
  });

  app.get([
    "/products",
    "/api/products",
    "/catalog/products",
    "/api/catalog/products",
    "/home/products",
    "/api/home/products",
    "/store/products",
    "/api/store/products"
  ], async (_req, res) => {
    try {
      const products = await listCollection("products");
      return res.json(products);
    } catch (err) {
      console.error("[products:get]", err);
      return res.status(500).json({ error: err.message || "Erro ao buscar produtos" });
    }
  });

  app.get([
    "/catalog/categories",
    "/api/catalog/categories",
    "/home/categories",
    "/api/home/categories"
  ], async (_req, res) => {
    try {
      const cats = await listCollection("categories", "name", "asc");
      return res.json(cats);
    } catch (err) {
      console.error("[categories:get aliases]", err);
      return res.status(500).json({ error: err.message || "Erro ao buscar categorias" });
    }
  });

  app.get([
    "/index-data",
    "/api/index-data",
    "/home",
    "/api/home",
    "/home/index-data",
    "/api/home/index-data"
  ], async (_req, res) => {
    try {
      const [products, categories, banners] = await Promise.all([
        listCollection("products"),
        listCollection("categories", "name", "asc"),
        listCollection("banners"),
      ]);

      return res.json({
        ok: true,
        products,
        categories,
        banners,
        bannerSlots: banners,
        headerCategoryBanner: resolveHeaderCategoryBanner(banners),
      });
    } catch (err) {
      console.error("[index-data:get]", err);
      return res.status(500).json({ error: err.message || "Erro ao montar index-data" });
    }
  });

  app.get("/settings/payments", async (_req, res) => {
    try {
      const snap = await settingsCollection().doc("payments").get();
      const data = snapData(snap) || {
        id: "payments",
        pix: { enabled: true, discountPercent: 17, label: "PIX" },
        boleto: { enabled: false, discountPercent: 0, label: "Boleto" },
        card: { enabled: true, maxInstallments: 12, interestFree: true },
      };
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message || "Erro ao buscar settings/payments" });
    }
  });


  // ================= HELPERS =================
  function normalizeDigits(v) {
    return String(v || "").replace(/\D/g, "");
  }

  function envFirst(...keys) {
    for (const k of keys) {
      if (!k) continue;
      const v = process.env[k];
      if (v && String(v).trim() !== "") return String(v).trim();
    }
    return "";
  }

  // ================= PAGAR.ME (fabricantes prioritários) =================
  initPagarmeManufacturerModule({
    app,
    admin,
    db,
    axios,
    envFirst,
    mergeOrder,
    writeAuditLog,
  });


  // ================= FABRICANTES / ADAPTER =================
  function slugifyVendor(v) {
    return String(v || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  const MANUFACTURER_ALIASES = {
    samsung: [
      "samsung", "samsung_oficial", "samsung_eletronics", "allied_samsung",
    ],
    motorola: [
      "motorola", "motorola_oficial", "motorola_mobility", "lenovo_motorola",
    ],
    whirlpool: [
      "whirlpool", "whirlpool_oficial", "brastemp", "consul", "kitchenaid", "maytag",
    ],
    lg: ["lg", "lg_electronics", "lge", "lg_oficial"],
    electrolux: ["electrolux", "electrolux_oficial", "electrolux_do_brasil"],
    midea: ["midea", "midea_carrier", "carrier_midea", "springer_midea", "comfee"],
    philips: ["philips", "philips_walita", "walita", "versuni"],
    panasonic: ["panasonic", "panasonic_do_brasil"],
    sony: ["sony", "sony_brasil"],
    tcl: ["tcl", "tcl_semp", "semp_tcl", "semp"],
    hisense: ["hisense"],
    dell: ["dell", "dell_technologies"],
    hp: ["hp", "hewlett_packard", "hp_inc"],
    lenovo: ["lenovo"],
    acer: ["acer"],
    asus: ["asus"],
    apple: ["apple", "apple_brasil"],
    intelbras: ["intelbras"],
    xiaomi: ["xiaomi"],
    realme: ["realme"],
    oppo: ["oppo"],
    vivo_mobile: ["vivo", "vivo_mobile", "vivo_global"],
    britania: ["britania", "philco", "philco_britania"],
    mondial: ["mondial"],
    arno: ["arno", "groupe_seb", "seb"],
    black_decker: ["black_decker", "black_and_decker"],
    bosch: ["bosch", "bsh", "continental", "bosch_home"],
    ge_appliances: ["ge", "ge_appliances", "haier", "haier_ge"],
    mallory: ["mallory"],
    cadence: ["cadence"],
    fisher_paykel: ["fisher_paykel", "fisherpaykel"],
    generic: ["generic", "generico"],
  };

  const MANUFACTURER_PROFILE_DEFAULTS = {
    samsung: { payloadMode: "retail_json", contentType: "application/json" },
    motorola: { payloadMode: "flat_json", contentType: "application/json" },
    whirlpool: { payloadMode: "whirlpool_json", contentType: "application/json" },
    lg: { payloadMode: "retail_json", contentType: "application/json" },
    electrolux: { payloadMode: "retail_json", contentType: "application/json" },
    midea: { payloadMode: "retail_json", contentType: "application/json" },
    philips: { payloadMode: "flat_json", contentType: "application/json" },
    panasonic: { payloadMode: "retail_json", contentType: "application/json" },
    sony: { payloadMode: "flat_json", contentType: "application/json" },
    tcl: { payloadMode: "retail_json", contentType: "application/json" },
    hisense: { payloadMode: "retail_json", contentType: "application/json" },
    dell: { payloadMode: "retail_json", contentType: "application/json" },
    hp: { payloadMode: "retail_json", contentType: "application/json" },
    lenovo: { payloadMode: "retail_json", contentType: "application/json" },
    acer: { payloadMode: "retail_json", contentType: "application/json" },
    asus: { payloadMode: "retail_json", contentType: "application/json" },
    apple: { payloadMode: "retail_json", contentType: "application/json" },
    intelbras: { payloadMode: "flat_json", contentType: "application/json" },
    xiaomi: { payloadMode: "flat_json", contentType: "application/json" },
    realme: { payloadMode: "flat_json", contentType: "application/json" },
    oppo: { payloadMode: "flat_json", contentType: "application/json" },
    vivo_mobile: { payloadMode: "flat_json", contentType: "application/json" },
    britania: { payloadMode: "nested_json", contentType: "application/json" },
    mondial: { payloadMode: "nested_json", contentType: "application/json" },
    arno: { payloadMode: "nested_json", contentType: "application/json" },
    black_decker: { payloadMode: "nested_json", contentType: "application/json" },
    bosch: { payloadMode: "soap_like_xml", contentType: "application/xml" },
    ge_appliances: { payloadMode: "nested_json", contentType: "application/json" },
    mallory: { payloadMode: "nested_json", contentType: "application/json" },
    cadence: { payloadMode: "nested_json", contentType: "application/json" },
    fisher_paykel: { payloadMode: "soap_like_xml", contentType: "application/xml" },
    generic: { payloadMode: "generic_json", contentType: "application/json" },
  };

  function normalizeManufacturerKey(value) {
    const s = slugifyVendor(value);
    if (!s) return "generic";

    for (const [canonical, aliases] of Object.entries(MANUFACTURER_ALIASES)) {
      if (canonical === s) return canonical;
      if (aliases.includes(s)) return canonical;
    }

    if (s.includes("samsung")) return "samsung";
    if (s.includes("motorola")) return "motorola";
    if (s.includes("whirlpool") || s.includes("brastemp") || s.includes("consul") || s.includes("kitchenaid") || s.includes("maytag")) return "whirlpool";
    if (s.includes("electrolux")) return "electrolux";
    if (s.includes("midea") || s.includes("carrier") || s.includes("comfee")) return "midea";
    if (s === "lg" || s.includes("lg_electronics") || s.includes("lge")) return "lg";
    if (s.includes("philips") || s.includes("walita") || s.includes("versuni")) return "philips";
    if (s.includes("panasonic")) return "panasonic";
    if (s.includes("sony")) return "sony";
    if (s.includes("tcl") || s.includes("semp")) return "tcl";
    if (s.includes("hisense")) return "hisense";
    if (s == "hp" || s.includes("hewlett_packard")) return "hp";
    if (s.includes("dell")) return "dell";
    if (s.includes("lenovo")) return "lenovo";
    if (s.includes("acer")) return "acer";
    if (s.includes("asus")) return "asus";
    if (s.includes("apple")) return "apple";
    if (s.includes("intelbras")) return "intelbras";
    if (s.includes("xiaomi")) return "xiaomi";
    if (s.includes("realme")) return "realme";
    if (s.includes("oppo")) return "oppo";
    if (s == "vivo" || s.includes("vivo_mobile")) return "vivo_mobile";
    if (s.includes("britania") || s.includes("philco")) return "britania";
    if (s.includes("mondial")) return "mondial";
    if (s.includes("arno") || s.includes("groupe_seb") || s == "seb") return "arno";
    if (s.includes("black_decker") || s.includes("black_and_decker")) return "black_decker";
    if (s.includes("bosch") || s == "bsh" || s.includes("continental")) return "bosch";
    if (s == "ge" || s.includes("ge_appliances") || s.includes("haier")) return "ge_appliances";
    if (s.includes("mallory")) return "mallory";
    if (s.includes("cadence")) return "cadence";
    if (s.includes("fisher_paykel") || s.includes("fisherpaykel")) return "fisher_paykel";

    return s;
  }

  function manufacturerEnvPrefix(manufacturer) {
    const key = normalizeManufacturerKey(manufacturer).toUpperCase();
    return key;
  }

  function buildXml(obj, nodeName = "root") {
    if (obj === null || obj === undefined) return `<${nodeName}></${nodeName}>`;
    if (Array.isArray(obj)) {
      return `<${nodeName}>${obj.map((item) => buildXml(item, "item")).join("")}</${nodeName}>`;
    }
    if (typeof obj === "object") {
      const inner = Object.entries(obj)
        .map(([k, v]) => buildXml(v, k))
        .join("");
      return `<${nodeName}>${inner}</${nodeName}>`;
    }
    const escaped = String(obj)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
    return `<${nodeName}>${escaped}</${nodeName}>`;
  }

  function buildSoapEnvelope(rootName, payload) {
    return `<?xml version="1.0" encoding="UTF-8"?>` +
      `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">` +
      `<soapenv:Header/>` +
      `<soapenv:Body>${buildXml(payload, rootName)}</soapenv:Body>` +
      `</soapenv:Envelope>`;
  }

  function buildEdiFromOrder(orderLike) {
    const orderId = String(
      orderLike?.id ||
      orderLike?.id_firebase ||
      orderLike?.idExterno ||
      orderLike?.external_id ||
      ""
    ).trim();

    const sku = String(
      orderLike?.sku_fabricante ||
      orderLike?.skuFabricante ||
      orderLike?.sku ||
      ""
    ).trim();

    const zip = normalizeDigits(
      orderLike?.cep_cliente ||
      orderLike?.cep ||
      orderLike?.shipping?.zip ||
      orderLike?.cliente?.cep ||
      ""
    );

    const qty = Number(orderLike?.quantity || orderLike?.quantidade || 1) || 1;
    return [
      "ISA*00*          *00*          *ZZ*ARIANAMOVEIS   *ZZ*FABRICANTE     *260313*1030*U*00401*000000001*0*T*>~",
      "GS*PO*ARIANAMOVEIS*FABRICANTE*20260313*1030*1*X*004010~",
      `ST*850*${orderId || "0001"}~`,
      `BEG*00*SA*${orderId || "SEM_ID"}**20260313~`,
      `PO1*1*${qty}*UN***BP*${sku || "SEM_SKU"}~`,
      zip ? `N3*CEP ${zip}~` : "",
      "CTT*1~",
      `SE*6*${orderId || "0001"}~`,
      "GE*1*1~",
      "IEA*1*000000001~",
    ].filter(Boolean).join("");
  }

  function orderItems(order) {
    const items = Array.isArray(order?.items) && order.items.length ? order.items : [order];
    return items.map((it) => ({
      sku: String(it?.sku_fabricante || it?.skuFabricante || it?.sku || it?.product_code || "").trim(),
      quantity: Number(it?.quantity || it?.quantidade || 1) || 1,
      unit_price: Number(it?.price || it?.valor || 0) || 0,
      name: it?.nome || it?.name || null,
    }));
  }

  function customerBlock(order) {
    return {
      name: order?.cliente?.nome || order?.customer_name || order?.nome || null,
      cpf: normalizeDigits(order?.cpf || order?.cliente?.cpf || order?.document || ""),
      email: order?.email || order?.cliente?.email || null,
      phone: normalizeDigits(order?.telefone || order?.cliente?.telefone || ""),
    };
  }

  function shippingBlock(order) {
    return {
      zip: normalizeDigits(order?.cep_cliente || order?.cep || order?.delivery_address?.zip || ""),
      street: order?.logradouro || order?.endereco?.logradouro || order?.delivery_address?.street || null,
      number: order?.numero_casa || order?.numero || order?.delivery_address?.number || null,
      complement: order?.complemento || order?.delivery_address?.complement || null,
      district: order?.bairro || order?.delivery_address?.district || null,
      city: order?.cidade || order?.delivery_address?.city || null,
      state: order?.uf || order?.estado || order?.delivery_address?.state || null,
      country: order?.pais || order?.country || "BR",
    };
  }

  function externalId(order) {
    return String(order?.id_firebase || order?.id || order?.orderId || order?.external_id || "").trim();
  }

  function genericRetailJson(order) {
    return {
      external_id: externalId(order),
      customer: customerBlock(order),
      items: orderItems(order),
      delivery_address: shippingBlock(order),
      metadata: {
        marketplace: "Ariana Móveis",
        seller_id: order?.sellerId || order?.seller_id || order?.vendedor_id || null,
        manufacturer_sku: order?.sku_fabricante || order?.skuFabricante || null,
      },
    };
  }

  function flatJson(order) {
    const firstItem = orderItems(order)[0] || {};
    return {
      external_id: externalId(order),
      customer_cpf: customerBlock(order).cpf,
      customer_name: customerBlock(order).name,
      customer_email: customerBlock(order).email,
      customer_phone: customerBlock(order).phone,
      product_code: firstItem.sku || null,
      quantity: firstItem.quantity || 1,
      unit_price: firstItem.unit_price || 0,
      delivery_address: shippingBlock(order),
    };
  }

  function whirlpoolJson(order) {
    return {
      orderData: {
        externalId: externalId(order),
        items: orderItems(order).map((it) => ({
          sku: it.sku,
          quantity: it.quantity,
          price: it.unit_price,
          name: it.name,
        })),
        shipping: shippingBlock(order),
        customer: customerBlock(order),
      },
    };
  }

  function nestedJson(order) {
    return {
      order: {
        header: {
          externalId: externalId(order),
          source: "ARIANA_MOVEIS",
        },
        customer: customerBlock(order),
        shipping: shippingBlock(order),
        items: orderItems(order).map((it, index) => ({
          line: index + 1,
          sku: it.sku,
          quantity: it.quantity,
          price: it.unit_price,
          description: it.name,
        })),
      },
    };
  }

  function soapLikeXmlObject(order) {
    return {
      submitOrderRequest: {
        orderHeader: {
          externalId: externalId(order),
          sourceSystem: "ARIANA_MOVEIS",
        },
        customer: customerBlock(order),
        shipping: shippingBlock(order),
        items: {
          item: orderItems(order).map((it, index) => ({
            lineNumber: index + 1,
            sku: it.sku,
            quantity: it.quantity,
            unitPrice: it.unit_price,
            description: it.name,
          })),
        },
      },
    };
  }

  function resolveManufacturerFromInput(input = {}) {
    const vendorRaw =
      input.manufacturer ||
      input.fabricante ||
      input.vendor ||
      input.vendor_id ||
      input.vendedor_id ||
      input.sellerId ||
      input.seller_id ||
      input.sellerUid ||
      input.brand ||
      "";

    return normalizeManufacturerKey(vendorRaw);
  }

  function sanitizeManufacturerIntegration(doc = {}, manufacturer = "generic") {
    const defaults = MANUFACTURER_PROFILE_DEFAULTS[manufacturer] || MANUFACTURER_PROFILE_DEFAULTS.generic;
    const endpoint = String(doc.api_endpoint || doc.apiEndpoint || "").trim();
    const token = String(doc.api_token || doc.apiToken || "").trim();
    const authHeader = String(doc.auth_header || doc.authHeader || "Authorization").trim();
    const authScheme = String(doc.auth_scheme || doc.authScheme || "Bearer").trim();
    const contentType = String(doc.content_type || doc.contentType || defaults.contentType || "application/json").trim().toLowerCase();
    const payloadMode = String(doc.payload_mode || doc.payloadMode || defaults.payloadMode || "generic_json").trim().toLowerCase();

    const aliases = Array.isArray(doc.aliases) ? doc.aliases.map((x) => String(x || "").trim()).filter(Boolean) : [];

    return {
      manufacturer,
      endpoint,
      token,
      authHeader,
      authScheme,
      contentType,
      payloadMode,
      aliases,
      isEnabled: doc.isEnabled !== false,
      transportMode: String(doc.transportMode || doc.transport_mode || "api").trim().toLowerCase(),
      sandboxEndpoint: String(doc.sandboxEndpoint || doc.sandbox_endpoint || "").trim(),
      sandboxToken: String(doc.sandboxToken || doc.sandbox_token || "").trim(),
      useSandbox: doc.useSandbox === true,
      certificateSecret: String(doc.certificateSecret || doc.certificate_secret || "").trim(),
      webhookToken: String(doc.webhookToken || doc.webhook_token || "").trim(),
      webhookHeader: String(doc.webhookHeader || doc.webhook_header || "").trim(),
      notes: String(doc.notes || "").trim(),
      raw: doc || {},
    };
  }

  async function getManufacturerProfileFromFirestore(manufacturer) {
    const key = normalizeManufacturerKey(manufacturer);
    if (!key) return null;

    const direct = await db.collection("manufacturer_integrations").doc(key).get();
    if (direct.exists) return sanitizeManufacturerIntegration(direct.data() || {}, key);

    const byAlias = await db.collection("manufacturer_integrations").where("aliases", "array-contains", key).limit(1).get();
    if (!byAlias.empty) {
      const snap = byAlias.docs[0];
      return sanitizeManufacturerIntegration(snap.data() || {}, normalizeManufacturerKey(snap.id));
    }

    return null;
  }

  function getManufacturerProfile(input = {}, firestoreProfile = null) {
    const manufacturer = resolveManufacturerFromInput(input);
    const prefix = manufacturerEnvPrefix(manufacturer);
    const defaults = MANUFACTURER_PROFILE_DEFAULTS[manufacturer] || MANUFACTURER_PROFILE_DEFAULTS.generic;
    const dbProfile = firestoreProfile ? sanitizeManufacturerIntegration(firestoreProfile, manufacturer) : null;

    const endpoint =
      String(
        input.api_endpoint ||
        input.apiEndpoint ||
        dbProfile?.endpoint ||
        envFirst(`${prefix}_API_ENDPOINT`, `MANUFACTURER_${prefix}_API_ENDPOINT`)
      ).trim();

    const token =
      String(
        input.api_token ||
        input.apiToken ||
        dbProfile?.token ||
        envFirst(`${prefix}_API_TOKEN`, `MANUFACTURER_${prefix}_API_TOKEN`)
      ).trim();

    const authHeader =
      String(
        input.auth_header ||
        input.authHeader ||
        dbProfile?.authHeader ||
        envFirst(`${prefix}_AUTH_HEADER`, `MANUFACTURER_${prefix}_AUTH_HEADER`) ||
        "Authorization"
      ).trim();

    const authScheme =
      String(
        input.auth_scheme ||
        input.authScheme ||
        dbProfile?.authScheme ||
        envFirst(`${prefix}_AUTH_SCHEME`, `MANUFACTURER_${prefix}_AUTH_SCHEME`) ||
        "Bearer"
      ).trim();

    const contentType =
      String(
        input.content_type ||
        input.contentType ||
        dbProfile?.contentType ||
        envFirst(`${prefix}_CONTENT_TYPE`, `MANUFACTURER_${prefix}_CONTENT_TYPE`) ||
        defaults.contentType ||
        "application/json"
      ).trim().toLowerCase();

    const payloadMode =
      String(
        input.payload_mode ||
        input.payloadMode ||
        dbProfile?.payloadMode ||
        envFirst(`${prefix}_PAYLOAD_MODE`, `MANUFACTURER_${prefix}_PAYLOAD_MODE`) ||
        defaults.payloadMode ||
        "generic_json"
      ).trim().toLowerCase();

    return {
      manufacturer,
      endpoint,
      token,
      authHeader,
      authScheme,
      contentType,
      payloadMode,
      aliases: dbProfile?.aliases || [],
      isEnabled: dbProfile?.isEnabled !== false,
      transportMode: dbProfile?.transportMode || "api",
      sandboxEndpoint: dbProfile?.sandboxEndpoint || "",
      sandboxToken: dbProfile?.sandboxToken || "",
      useSandbox: dbProfile?.useSandbox === true,
      certificateSecret: dbProfile?.certificateSecret || "",
      webhookToken: dbProfile?.webhookToken || "",
      webhookHeader: dbProfile?.webhookHeader || "",
      notes: dbProfile?.notes || "",
      source: dbProfile ? "firestore+env" : "env",
    };
  }

  const ManufacturerAdapter = {
    samsung: { format: genericRetailJson },
    motorola: { format: flatJson },
    whirlpool: { format: whirlpoolJson },
    lg: { format: genericRetailJson },
    electrolux: { format: genericRetailJson },
    midea: { format: genericRetailJson },
    philips: { format: flatJson },
    panasonic: { format: genericRetailJson },
    sony: { format: flatJson },
    tcl: { format: genericRetailJson },
    hisense: { format: genericRetailJson },
    dell: { format: genericRetailJson },
    hp: { format: genericRetailJson },
    lenovo: { format: genericRetailJson },
    acer: { format: genericRetailJson },
    asus: { format: genericRetailJson },
    apple: { format: genericRetailJson },
    intelbras: { format: flatJson },
    xiaomi: { format: flatJson },
    realme: { format: flatJson },
    oppo: { format: flatJson },
    vivo_mobile: { format: flatJson },
    britania: { format: nestedJson },
    mondial: { format: nestedJson },
    arno: { format: nestedJson },
    black_decker: { format: nestedJson },
    bosch: { format: soapLikeXmlObject },
    ge_appliances: { format: nestedJson },
    mallory: { format: nestedJson },
    cadence: { format: nestedJson },
    fisher_paykel: { format: soapLikeXmlObject },
    generic: { format(order) { return order; } },
  };

  function formatPayloadByMode(order, profile) {
    const mode = String(profile?.payloadMode || "").toLowerCase();
    switch (mode) {
      case "retail_json":
        return genericRetailJson(order);
      case "flat_json":
        return flatJson(order);
      case "whirlpool_json":
        return whirlpoolJson(order);
      case "nested_json":
        return nestedJson(order);
      case "soap_like_xml":
        return soapLikeXmlObject(order);
      case "edi_x12":
        return buildEdiFromOrder(order);
      case "generic_json":
      default: {
        const adapter = ManufacturerAdapter[profile?.manufacturer] || ManufacturerAdapter.generic;
        return adapter.format(order);
      }
    }
  }

  function formatForManufacturer(order, profile) {
    const payload = formatPayloadByMode(order, profile);

    if ((profile?.contentType || "").includes("xml")) {
      const xmlBody =
        profile?.payloadMode === "soap_like_xml"
          ? buildSoapEnvelope("submitOrder", payload)
          : `<?xml version="1.0" encoding="UTF-8"?>${buildXml(payload, "order")}`;

      return {
        body: xmlBody,
        contentType: "application/xml",
      };
    }

    if ((profile?.contentType || "").includes("edi") || profile?.payloadMode === "edi_x12") {
      return {
        body: typeof payload === "string" ? payload : buildEdiFromOrder(order),
        contentType: "application/edi-x12",
      };
    }

    return {
      body: payload,
      contentType: "application/json",
    };
  }

  async function mergePedidoAndOrder(orderId, patch) {
    if (!orderId) return;
    const id = String(orderId).trim();
    if (!id) return;

    const merged = {
      ...patch,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await Promise.all([
      db.collection("orders").doc(id).set(merged, { merge: true }),
      db.collection("pedidos").doc(id).set(merged, { merge: true }),
    ]);
  }


  function toNumberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function normalizeManufacturerOrderPayload(input = {}, existing = {}) {
    const src = { ...(existing || {}), ...(input || {}) };

    const orderId = String(
      src.orderId || src.id || src.id_firebase || src.external_id || src.idExterno || ""
    ).trim();

    const manufacturer = normalizeManufacturerKey(
      src.manufacturer || src.fabricante || src.vendor || src.vendedor_id || src.seller_id || "generic"
    );

    const itemsRaw = Array.isArray(src.items)
      ? src.items
      : Array.isArray(src.itens)
        ? src.itens
        : (src.sku_fabricante || src.sku || src.product_code)
          ? [{
              sku_fabricante: src.sku_fabricante || src.sku || src.product_code || null,
              sku: src.sku || src.sku_fabricante || src.product_code || null,
              product_code: src.product_code || src.sku_fabricante || src.sku || null,
              quantity: src.quantity || src.qty || 1,
              price: src.price || src.unit_price || src.valor_unitario || null,
              nome: src.nome || src.product_name || null,
            }]
          : [];

    const items = itemsRaw.map((item, index) => ({
      lineId: String(item.lineId || item.id || index + 1),
      sku_fabricante: String(item.sku_fabricante || item.skuFabricante || item.product_code || item.sku || "").trim() || null,
      sku: String(item.sku || item.sku_fabricante || item.product_code || "").trim() || null,
      ean: String(item.ean || item.gtin || "").trim() || null,
      nome: String(item.nome || item.name || item.product_name || "").trim() || null,
      quantity: Math.max(1, parseInt(item.quantity || item.qty || 1, 10) || 1),
      unitPrice: toNumberOrNull(item.unitPrice || item.price || item.unit_price || item.valor_unitario),
      totalPrice: toNumberOrNull(item.totalPrice || item.total_price || item.valor_total),
      category: String(item.category || item.categoria || "").trim() || null,
      brand: String(item.brand || item.marca || "").trim() || null,
    }));

    const normalized = {
      orderId: orderId || null,
      id: orderId || null,
      id_firebase: orderId || null,
      idExterno: orderId || null,
      external_id: orderId || null,
      manufacturer,
      manufacturerAlias: String(src.manufacturer || src.fabricante || src.vendor || src.vendedor_id || src.seller_id || manufacturer).trim() || manufacturer,
      vendedor_id: String(src.vendedor_id || src.seller_id || manufacturer).trim() || manufacturer,
      sellerId: String(src.sellerId || src.seller_id || src.vendedor_id || manufacturer).trim() || manufacturer,
      sku_fabricante: String(src.sku_fabricante || src.sku || src.product_code || items?.[0]?.sku_fabricante || "").trim() || null,
      api_endpoint: String(src.api_endpoint || src.endpoint || "").trim() || null,
      status_integracao: String(src.status_integracao || src.integration_status || "pendente").trim() || "pendente",
      environment: String(src.environment || (src.useSandbox ? "sandbox" : "production")).trim() || "production",
      createdAtClient: src.createdAtClient || src.created_at || null,
      customer: {
        id: String(src.customerId || src.customer_id || src.uid || "").trim() || null,
        nome: String(src.nome || src.customer_name || src.customerName || "").trim() || null,
        email: String(src.email || src.customer_email || "").trim().toLowerCase() || null,
        cpf: normalizeDigits(src.cpf || src.customer_cpf || src.document || "") || null,
        telefone: normalizeDigits(src.telefone || src.phone || src.customer_phone || "") || null,
      },
      shippingAddress: {
        cep: normalizeDigits(src.cep_cliente || src.cep || src.zip || "") || null,
        logradouro: String(src.logradouro || src.street || src.endereco || "").trim() || null,
        numero: String(src.numero_casa || src.numero || src.number || "").trim() || null,
        complemento: String(src.complemento || src.address2 || "").trim() || null,
        bairro: String(src.bairro || src.district || "").trim() || null,
        cidade: String(src.cidade || src.city || "").trim() || null,
        uf: String(src.uf || src.state || "").trim() || null,
        pais: String(src.pais || src.country || "BR").trim() || "BR",
        referencia: String(src.referencia || src.reference || "").trim() || null,
      },
      billing: {
        subtotal: toNumberOrNull(src.subtotal || src.valor_produtos),
        shipping: toNumberOrNull(src.shipping || src.freight || src.valor_frete),
        discount: toNumberOrNull(src.discount || src.desconto || src.valor_desconto),
        total: toNumberOrNull(src.total || src.amount || src.valor_total),
        currency: String(src.currency || src.moeda || "BRL").trim() || "BRL",
        paymentMethod: String(src.paymentMethod || src.payment_method || src.metodo_pagamento || "").trim() || null,
        installments: parseInt(src.installments || src.parcelas || 1, 10) || 1,
      },
      antiFraud: {
        provider: String(src.antiFraudProvider || src.antifraude_provider || "").trim() || null,
        status: String(src.antiFraudStatus || src.antifraude_status || "pendente").trim() || "pendente",
        score: toNumberOrNull(src.antiFraudScore || src.antifraude_score),
        analysisId: String(src.antiFraudId || src.antifraude_id || "").trim() || null,
      },
      fiscal: {
        invoiceRequired: Boolean(src.invoiceRequired ?? true),
        nfeStatus: String(src.nfeStatus || src.fiscal_status || "pendente").trim() || "pendente",
        cnpjEmitente: normalizeDigits(src.cnpj_emitente || src.cnpjEmitente || "") || null,
        ieEmitente: String(src.ie_emitente || src.ieEmitente || "").trim() || null,
      },
      logistics: {
        deliveryType: String(src.deliveryType || src.tipo_entrega || "fabricante").trim() || "fabricante",
        carrierPreference: String(src.carrierPreference || src.transportadora_preferida || "").trim() || null,
        warehouseCode: String(src.warehouseCode || src.cd || src.codigo_cd || "").trim() || null,
      },
      tracking: src.tracking && typeof src.tracking === "object" ? src.tracking : {
        code: String(src.codigo_rastreio || src.tracking_code || "").trim() || null,
        carrier: String(src.transportadora || src.carrier || "").trim() || null,
        status: String(src.status_entrega || src.delivery_status || "").trim() || null,
      },
      manufacturerResponse: src.manufacturerResponse || src.integracao_fabricante || null,
      raw: src.raw || null,
      items,
      integrationEvents: Array.isArray(src.integrationEvents) ? src.integrationEvents : [],
    };

    if (normalized.billing.total === null) {
      const itemsTotal = items.reduce((sum, item) => sum + ((item.totalPrice ?? ((item.unitPrice || 0) * (item.quantity || 1))) || 0), 0);
      const shipping = normalized.billing.shipping || 0;
      const discount = normalized.billing.discount || 0;
      normalized.billing.total = Number((itemsTotal + shipping - discount).toFixed(2));
    }

    normalized.integrationSnapshot = {
      manufacturer: normalized.manufacturer,
      sku_fabricante: normalized.sku_fabricante,
      environment: normalized.environment,
      status_integracao: normalized.status_integracao,
      antiFraudStatus: normalized.antiFraud.status,
      nfeStatus: normalized.fiscal.nfeStatus,
      deliveryStatus: normalized.tracking?.status || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    return normalized;
  }

  async function loadOrderForPreparation(orderId) {
    if (!orderId) return null;
    const [orderSnap, pedidoSnap] = await Promise.all([
      db.collection("orders").doc(orderId).get(),
      db.collection("pedidos").doc(orderId).get(),
    ]);

    if (orderSnap.exists) return { id: orderSnap.id, ...orderSnap.data() };
    if (pedidoSnap.exists) return { id: pedidoSnap.id, ...pedidoSnap.data() };
    return null;
  }

  function buildPreparationChecklist(normalized) {
    return {
      antifraude: normalized.antiFraud?.status === "aprovado" || normalized.antiFraud?.status === "approved",
      faturamento: Boolean(normalized.fiscal?.invoiceRequired),
      endereco: Boolean(normalized.shippingAddress?.cep && normalized.shippingAddress?.logradouro && normalized.shippingAddress?.numero),
      cliente: Boolean(normalized.customer?.nome && normalized.customer?.cpf),
      itens: Array.isArray(normalized.items) && normalized.items.length > 0 && normalized.items.every((item) => item.sku_fabricante && item.quantity > 0),
      fabricante: Boolean(normalized.manufacturer && normalized.manufacturer !== "generic"),
    };
  }

  function parseTrackingInput(req) {
    const body = (req && typeof req.body === "object" && req.body !== null) ? req.body : {};
    return {
      raw: body,
      orderId: String(
        body.id_externo ||
        body.external_id ||
        body.externalId ||
        body.orderId ||
        body.order_id ||
        body.order_number ||
        body.numero_pedido ||
        body.pedido_id ||
        req.query?.orderId ||
        req.query?.id_externo ||
        ""
      ).trim(),
      status: String(
        body.status ||
        body.shipping_status ||
        body.delivery_status ||
        body.tracking_status ||
        body.event ||
        body.event_name ||
        "atualizado"
      ).trim(),
      trackingCode: String(
        body.tracking_code ||
        body.trackingCode ||
        body.codigo_rastreio ||
        body.awb ||
        body.codigo ||
        ""
      ).trim(),
      carrier: String(
        body.carrier ||
        body.transportadora ||
        body.shipper ||
        body.logistics_provider ||
        ""
      ).trim(),
      description: String(
        body.description ||
        body.descricao ||
        body.message ||
        body.event_description ||
        ""
      ).trim(),
      occurredAt:
        body.occurred_at ||
        body.occurredAt ||
        body.updated_at ||
        body.timestamp ||
        body.data_evento ||
        null,
      location: String(
        body.location ||
        body.local ||
        body.city ||
        body.cidade ||
        ""
      ).trim(),
    };
  }

  function verifyTrackingWebhook(req) {
    const expectedToken = envFirst("TRACKING_WEBHOOK_TOKEN");
    if (!expectedToken) return true;

    const headerName = String(envFirst("TRACKING_WEBHOOK_HEADER") || "x-webhook-token").toLowerCase();
    const received =
      req.get(headerName) ||
      req.get(headerName.toUpperCase()) ||
      req.query?.token ||
      "";

    return String(received || "").trim() === String(expectedToken).trim();
  }

  async function processTrackingWebhook(req, res) {
    if (req.method !== "POST") {
      return res.status(405).send("Método não permitido");
    }

    if (!verifyTrackingWebhook(req)) {
      return res.status(401).json({ ok: false, error: "Token do webhook inválido" });
    }

    try {
      const input = parseTrackingInput(req);

      if (!input.orderId) {
        return res.status(400).json({ ok: false, error: "ID do pedido não encontrado" });
      }

      const eventPayload = {
        status: input.status || null,
        descricao: input.description || null,
        local: input.location || null,
        carrier: input.carrier || null,
        codigo_rastreio: input.trackingCode || null,
        occurredAt: input.occurredAt || null,
        raw: input.raw || null,
      };

      await mergePedidoAndOrder(input.orderId, {
        status_entrega: input.status || null,
        codigo_rastreio: input.trackingCode || null,
        transportadora: input.carrier || null,
        ultima_atualizacao: admin.firestore.FieldValue.serverTimestamp(),
        tracking: {
          code: input.trackingCode || null,
          carrier: input.carrier || null,
          status: input.status || null,
          description: input.description || null,
          location: input.location || null,
          occurredAt: input.occurredAt || null,
          raw: input.raw || null,
        },
        trackingLastEvent: eventPayload,
        trackingEvents: admin.firestore.FieldValue.arrayUnion(eventPayload),
        deliveryStatus: input.status || null,
      });

      await writeAuditLog({
        scope: "tracking_webhook",
        eventType: "webhook_tracking_received",
        orderId: input.orderId,
        manufacturer: resolveManufacturerFromInput(input.raw || {}),
        status: "success",
        request: { headers: req.headers || {}, body: input.raw || req.body || null },
        response: { message: "Webhook processado" },
        metadata: { trackingCode: input.trackingCode || null, carrier: input.carrier || null, deliveryStatus: input.status || null },
      });

      return res.status(200).json({ ok: true, message: "Webhook processado", orderId: input.orderId });
    } catch (error) {
      console.error("[webhook rastreio] erro:", error);
      return res.status(500).json({ ok: false, error: "Erro interno" });
    }
  }

  async function dispatchOrderToManufacturer(orderInput = {}) {
    const firestoreProfile = await getManufacturerProfileFromFirestore(resolveManufacturerFromInput(orderInput));
    const profile = getManufacturerProfile(orderInput, firestoreProfile);

    if (profile.isEnabled === false) {
      throw new Error(`Integração desativada para ${profile.manufacturer}`);
    }

    if (!profile.endpoint && !(profile.useSandbox && profile.sandboxEndpoint)) {
      throw new Error(`Endpoint do fabricante não configurado para ${profile.manufacturer}`);
    }

    const formatted = formatForManufacturer(orderInput, profile);
    const headers = {
      "Content-Type": formatted.contentType,
    };

    const targetUrl = profile.useSandbox && profile.sandboxEndpoint ? profile.sandboxEndpoint : profile.endpoint;
    const tokenToUse = profile.useSandbox && profile.sandboxToken ? profile.sandboxToken : profile.token;

    if (tokenToUse) {
      headers[profile.authHeader] = profile.authScheme ? `${profile.authScheme} ${tokenToUse}` : tokenToUse;
    }

    const requestConfig = {
      method: "POST",
      url: targetUrl,
      headers,
      timeout: 30000,
      data: formatted.body,
      validateStatus: () => true,
    };

    const response = await axios(requestConfig);
    await writeAuditLog({
      scope: "manufacturer_dispatch",
      eventType: "manufacturer_dispatch_http",
      orderId: orderInput.orderId || orderInput.id || null,
      manufacturer: profile.manufacturer,
      status: response.status >= 200 && response.status < 300 ? "success" : "error",
      statusCode: response.status,
      request: { endpoint: targetUrl, headers, body: formatted.body, contentType: formatted.contentType },
      response: { data: response.data || null },
      metadata: { payloadMode: profile.payloadMode || null, transportMode: profile.transportMode || null, useSandbox: profile.useSandbox === true },
    });
    return {
      manufacturer: profile.manufacturer,
      endpoint: targetUrl,
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      data: response.data || null,
      sentContentType: formatted.contentType,
      sentBody: formatted.body,
    };
  }


  function redactProfile(profile = {}) {
    return {
      manufacturer: profile.manufacturer || "generic",
      endpoint: profile.endpoint || "",
      authHeader: profile.authHeader || "Authorization",
      authScheme: profile.authScheme || "Bearer",
      contentType: profile.contentType || "application/json",
      payloadMode: profile.payloadMode || "generic_json",
      aliases: Array.isArray(profile.aliases) ? profile.aliases : [],
      isEnabled: profile.isEnabled !== false,
      transportMode: profile.transportMode || "api",
      sandboxEndpoint: profile.sandboxEndpoint || "",
      useSandbox: profile.useSandbox === true,
      certificateSecretConfigured: Boolean(profile.certificateSecret),
      webhookHeader: profile.webhookHeader || "",
      notes: profile.notes || "",
      hasToken: Boolean(profile.token),
      hasSandboxToken: Boolean(profile.sandboxToken),
      source: profile.source || "env",
    };
  }

  function normalizeIntegrationWritePayload(body = {}) {
    const manufacturer = resolveManufacturerFromInput(body);
    return {
      manufacturer,
      aliases: Array.isArray(body.aliases) ? body.aliases.map((x) => normalizeManufacturerKey(x)).filter(Boolean) : [],
      isEnabled: body.isEnabled !== false,
      api_endpoint: String(body.api_endpoint || body.apiEndpoint || "").trim(),
      api_token: String(body.api_token || body.apiToken || "").trim(),
      auth_header: String(body.auth_header || body.authHeader || "Authorization").trim(),
      auth_scheme: String(body.auth_scheme || body.authScheme || "Bearer").trim(),
      content_type: String(body.content_type || body.contentType || "application/json").trim().toLowerCase(),
      payload_mode: String(body.payload_mode || body.payloadMode || "generic_json").trim().toLowerCase(),
      transport_mode: String(body.transport_mode || body.transportMode || "api").trim().toLowerCase(),
      sandbox_endpoint: String(body.sandbox_endpoint || body.sandboxEndpoint || "").trim(),
      sandbox_token: String(body.sandbox_token || body.sandboxToken || "").trim(),
      useSandbox: body.useSandbox === true,
      certificate_secret: String(body.certificate_secret || body.certificateSecret || "").trim(),
      webhook_token: String(body.webhook_token || body.webhookToken || "").trim(),
      webhook_header: String(body.webhook_header || body.webhookHeader || "").trim(),
      notes: String(body.notes || "").trim(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
  }


  // --- IDENTIDADE DA PLATAFORMA (Ariana) ---
  // Se o pedido/produto vier com sellerId igual a este UID, tratamos como "produto da plataforma"
  // e cobramos com o token principal (sem exigir OAuth do seller).
  const PLATFORM_SELLER_UID = envFirst("PLATFORM_SELLER_UID", "MP_PLATFORM_SELLER_UID", "ARIANA_PLATFORM_UID");
  const MP_PLATFORM_ACCESS_TOKEN = envFirst("MP_ACCESS_TOKEN_PLATFORM", "MP_ACCESS_TOKEN");

  function parseServices(raw) {
    const s = String(raw || "").trim();
    if (!s) return ["03220", "03298"];
    return s.split(/[;, ]+/).map((x) => x.trim()).filter(Boolean);
  }

  function toGrams(pesoKg) {
    const n = Number(pesoKg);
    if (!Number.isFinite(n) || n <= 0) return null;
    return String(Math.round(n * 1000));
  }

  function positiveIntOrNull(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return String(Math.round(n));
  }

  function safeAxiosError(e) {
    return {
      message: e?.message || String(e),
      status: e?.response?.status || null,
      data: e?.response?.data || null,
    };
  }

  // Converte "126,30" -> 126.30 (Number) | aceita Number também
  function toNumberPtBr(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const s = String(v).trim();
    if (!s) return null;
    const normalized = s.replace(/\./g, "").replace(",", ".");
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }

  function pickPrice(rawItem) {
    return (
      toNumberPtBr(rawItem?.pcFinal) ??
      toNumberPtBr(rawItem?.pcBaseGeral) ??
      toNumberPtBr(rawItem?.pcReferencia) ??
      toNumberPtBr(rawItem?.pcBase) ??
      null
    );
  }

  function pickDeadline(rawItem) {
    return (
      Number(rawItem?.prazoEntrega) ||
      Number(rawItem?.nuPrazoEntrega) ||
      Number(rawItem?.prazo) ||
      null
    );
  }

  // ================= MARKETPLACE SPLIT (12%) =================
const MP_BASE = "https://api.mercadopago.com";
const MP_COMMISSION_RATE = 0.12; // 12%

function round2(n) {
  const x = Number(n || 0);
  return Math.round(x * 100) / 100;
}

function calcSubtotalFromItems(items) {
  if (!Array.isArray(items)) return 0;
  let sum = 0;
  for (const it of items) {
    const price = Number(it?.price || 0);
    const qty = Number(it?.quantity || 1);
    if (Number.isFinite(price) && Number.isFinite(qty)) sum += price * qty;
  }
  return round2(sum);
}

function calcCommission12(subtotal) {
  return round2(Number(subtotal || 0) * MP_COMMISSION_RATE);
}

async function getOrderById(orderId) {
  const id = String(orderId || "").trim();
  if (!id) return null;

  const snap = await db.collection("orders").doc(id).get();
  if (!snap.exists) return null;
  return { id, data: snap.data() || {}, ref: snap.ref };
}

async function getSellerDocById(sellerId) {
  const id = String(sellerId || "").trim();
  if (!id) return null;
  const snap = await db.collection("sellers").doc(id).get();
  if (!snap.exists) return null;
  return { id, data: snap.data() || {}, ref: snap.ref };
}

async function refreshSellerTokenIfNeeded(seller) {
  // Retorna access_token atualizado (se possível). Não quebra se refresh falhar.
  const d = seller?.data || {};
  const accessToken = String(d.mp_access_token || d.mpAccessToken || "").trim();
  const refreshToken = String(d.mp_refresh_token || d.mpRefreshToken || "").trim();
  const expiresAt = Number(d.mp_token_expires_at || d.mpTokenExpiresAt || 0);

  if (!accessToken) return "";

  // Se não há expiresAt, assume válido
  if (!expiresAt) return accessToken;

  const now = Date.now();
  if (expiresAt - now > 60_000) return accessToken; // ainda válido (>= 1 min)

  const clientId = envFirst("MP_CLIENT_ID", "MERCADOPAGO_CLIENT_ID");
  const clientSecret = envFirst("MP_CLIENT_SECRET", "MERCADOPAGO_CLIENT_SECRET");
  const redirectUri = envFirst("MP_OAUTH_REDIRECT_URI", "MERCADOPAGO_OAUTH_REDIRECT_URI", "");

  if (!clientId || !clientSecret || !refreshToken) return accessToken;

  try {
    const resp = await axios.post(
      `${MP_BASE}/oauth/token`,
      {
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        ...(redirectUri ? { redirect_uri: redirectUri } : {}),
      },
      { timeout: 20000 }
    );

    const t = resp?.data || {};
    const newAccess = String(t.access_token || "").trim();
    const newRefresh = String(t.refresh_token || refreshToken).trim();
    const expiresIn = Number(t.expires_in || 0);
    const newExpiresAt = expiresIn ? (Date.now() + (expiresIn * 1000)) : expiresAt;

    if (newAccess) {
      await seller.ref.set(
        {
          mp_access_token: newAccess,
          mp_refresh_token: newRefresh,
          mp_token_expires_at: newExpiresAt,
          mp_user_id: t.user_id || d.mp_user_id || d.mpUserId || null,
          mp_connected: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return newAccess;
    }
    return accessToken;
  } catch (_e) {
    return accessToken;
  }
}

async function resolveSplitContext(orderId, amountFromBody) {
  const order = await getOrderById(orderId);
  if (!order) {
    return {
      order: null,
      sellerId: null,
      sellerToken: "",
      transactionAmount: round2(amountFromBody),
      applicationFee: 0,
    };
  }

  const data = order.data || {};
  const totals = data.totals || {};

  let sellerId =
    data.sellerId ||
    data.sellerUid ||
    (Array.isArray(data.items) ? data.items?.[0]?.sellerId : null) ||
    null;

  // Se o pedido veio marcado com o sellerId da própria plataforma, tratamos como venda da Ariana.
  if (sellerId && PLATFORM_SELLER_UID && String(sellerId) === String(PLATFORM_SELLER_UID)) {
    sellerId = null;
  }

  const subtotal =
    Number(totals.subtotal ?? 0) ||
    calcSubtotalFromItems(data.items);

  const shipping = Number(totals.shipping ?? 0) || 0;
  const total = Number(totals.total ?? 0) || round2(subtotal + shipping);

  const transactionAmount = round2(total > 0 ? total : amountFromBody);
  // comissão 12% no subtotal (frete é do cliente)
  const applicationFee = calcCommission12(subtotal > 0 ? subtotal : transactionAmount);

  const finalApplicationFee = sellerId ? applicationFee : 0;

  const seller = await getSellerDocById(sellerId);
  const sellerToken = seller ? await refreshSellerTokenIfNeeded(seller) : "";

  return { order, sellerId, sellerToken, transactionAmount, applicationFee: finalApplicationFee };
}

function mpHeaders(token, req, idemKey) {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Idempotency-Key": makeIdempotencyKey(req, idemKey),
    },
    timeout: 20000,
  };
}

function makeIdempotencyKey(req, fallbackSeed) {
    const incoming =
      req.get("x-idempotency-key") ||
      req.get("X-Idempotency-Key") ||
      req.get("x-mp-idempotency-key") ||
      req.get("X-Mp-Idempotency-Key");

    const cleaned = incoming && String(incoming).trim();
    if (cleaned) return cleaned;

    // gera estável e curto (e NÃO nulo)
    const seed = String(fallbackSeed || Date.now());
    const hash = crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32);
    return "idem-" + hash;
  }

  // Split nome completo em first_name / last_name (MP exige ambos no boleto registrado)
  function splitFullName(fullName) {
    const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { first: "Cliente", last: "Cliente" };
    if (parts.length === 1) return { first: parts[0], last: "Cliente" };
    const first = parts[0];
    const last = parts.slice(1).join(" ");
    return { first, last };
  }

  // Mercado Pago (boleto registrado) pode exigir endereço do pagador
  function extractBoletoAddress(body) {
    const a = body?.payerAddress || body?.address || {};
    const zip = String(a.zip_code || a.zipCode || body?.zip_code || body?.zipCode || "").replace(/\D/g, "");
    const street = String(a.street_name || a.street || body?.street_name || body?.street || "").trim();
    const number = String(a.street_number || a.number || body?.street_number || body?.number || "").trim();
    const neighborhood = String(a.neighborhood || body?.neighborhood || "").trim();
    const city = String(a.city || body?.city || "").trim();
    const uf = String(
      a.federal_unit || a.state || a.uf || body?.federal_unit || body?.state || body?.uf || ""
    ).trim().toUpperCase();

    const missing = [];
    if (zip.length !== 8) missing.push("payer.address.zip_code");
    if (!street) missing.push("payer.address.street_name");
    if (!number) missing.push("payer.address.street_number");
    if (!neighborhood) missing.push("payer.address.neighborhood");
    if (!city) missing.push("payer.address.city");
    if (!uf) missing.push("payer.address.federal_unit");

    return {
      ok: missing.length === 0,
      missing,
      address: {
        zip_code: zip,
        street_name: street,
        street_number: number,
        neighborhood,
        city,
        federal_unit: uf,
      },
    };
  }

  // Nomes dos serviços
  const SERVICE_NAMES = {
    "03298": "PAC",
    "03220": "SEDEX",
  };

  // ================= DEBUG =================
  app.get("/debug/build", (_req, res) => {
    res.json({ ok: true, build: BUILD_ID });
  });

  // DEBUG: Mercado Pago (sem expor segredos)
  app.get("/debug/mp", (_req, res) => {
    res.json({
      ok: true,
      build: BUILD_ID,
      MP_ACCESS_TOKEN: process.env.MP_ACCESS_TOKEN ? "OK" : "MISSING",
      MP_PUBLIC_KEY: (process.env.MP_PUBLIC_KEY || process.env.MERCADOPAGO_PUBLIC_KEY || process.env.MP_PUBLIC_KEY_PROD)
        ? "OK"
        : "MISSING",
    });

  });



  // ================= MERCADO PAGO OAUTH (CONNECT SELLER) =================
  // Fluxo:
  // 1) Front chama GET /mp/oauth/url com header Authorization: Bearer <Firebase ID Token>
  // 2) Front redireciona o vendedor para a URL retornada
  // 3) MP redireciona para MP_OAUTH_REDIRECT_URI (esta function): GET /mp/oauth/callback?code=...&state=<sellerUid>
  //
  // ENV/Secrets necessários:
  // MP_CLIENT_ID, MP_CLIENT_SECRET, MP_OAUTH_REDIRECT_URI

  async function requireSellerAuth(req) {
    const authHeader = String(req.get("authorization") || "");
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    const idToken = m ? m[1] : null;
    if (!idToken) throw new Error("missing_auth");

    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded?.uid;
    if (!uid) throw new Error("invalid_auth");

    // confirma que é seller no Firestore
    const snap = await db.collection("sellers").doc(uid).get();
    if (!snap.exists) throw new Error("not_seller");
    return { uid };
  }


  function normalizeSkuKey(value) {
    return String(value || "")
      .trim()
      .toUpperCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Z0-9_-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function cleanProductPayload(raw, uid) {
    const data = raw && typeof raw === "object" ? { ...raw } : {};
    const sku = normalizeSkuKey(data.sku || data.skuNormalized || "");
    if (!sku) throw new Error("SKU obrigatório.");

    data.sku = sku;
    data.skuNormalized = sku;
    data.sellerId = uid;
    data.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    if (!data.createdAt) {
      data.createdAt = admin.firestore.FieldValue.serverTimestamp();
    }

    return data;
  }

  app.post("/seller/products/upsert", async (req, res) => {
    try {
      const { uid } = await requireSellerAuth(req);
      const body = req.body || {};
      const productId = String(body.productId || "").trim();
      const payload = cleanProductPayload(body.data, uid);
      const productsRef = db.collection("products");
      const productRef = productId ? productsRef.doc(productId) : productsRef.doc();
      const skuRef = db.collection("product_skus").doc(payload.sku);

      await db.runTransaction(async (tx) => {
        const existingSnap = await tx.get(productRef);
        const existing = existingSnap.exists ? (existingSnap.data() || {}) : null;

        if (existing && String(existing.sellerId || "") !== String(uid)) {
          throw new Error("Você não tem permissão para alterar este produto.");
        }

        const skuSnap = await tx.get(skuRef);
        if (skuSnap.exists) {
          const skuData = skuSnap.data() || {};
          if (String(skuData.productId || "") !== String(productRef.id)) {
            throw new Error("Já existe um produto com este SKU.");
          }
        }

        const previousSku = normalizeSkuKey(existing?.sku || existing?.skuNormalized || "");
        if (previousSku && previousSku !== payload.sku) {
          const previousSkuRef = db.collection("product_skus").doc(previousSku);
          const previousSkuSnap = await tx.get(previousSkuRef);
          if (previousSkuSnap.exists) {
            const previousData = previousSkuSnap.data() || {};
            if (String(previousData.productId || "") === String(productRef.id)) {
              tx.delete(previousSkuRef);
            }
          }
        }

        tx.set(productRef, payload, { merge: true });
        tx.set(skuRef, {
          sku: payload.sku,
          productId: productRef.id,
          sellerId: uid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          createdAt: skuSnap.exists ? (skuSnap.data() || {}).createdAt || admin.firestore.FieldValue.serverTimestamp() : admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      });

      return res.json({ ok: true, productId: productRef.id, sku: payload.sku });
    } catch (e) {
      const message = String(e?.message || e || "Erro ao salvar produto");
      const status = /permissão|permission|auth/i.test(message) ? 403 : (/SKU/i.test(message) ? 409 : 400);
      return res.status(status).json({ ok: false, error: message });
    }
  });

  app.get("/mp/oauth/url", async (req, res) => {
    try {
      const { uid } = await requireSellerAuth(req);

      const clientId = envFirst("MP_CLIENT_ID", "MERCADOPAGO_CLIENT_ID");
      const redirectUri = envFirst("MP_OAUTH_REDIRECT_URI", "MERCADOPAGO_OAUTH_REDIRECT_URI");
      if (!clientId || !redirectUri) {
        return res.status(500).json({ ok: false, error: "missing_mp_oauth_env" });
      }

      const url =
        "https://auth.mercadopago.com.br/authorization" +
        `?client_id=${encodeURIComponent(clientId)}` +
        `&response_type=code` +
        `&platform_id=mp` +
        `&state=${encodeURIComponent(uid)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}`;

      return res.json({ ok: true, url });
    } catch (_e) {
      return res.status(401).json({ ok: false, error: "not_authorized" });
    }
  });

  app.get("/mp/oauth/callback", async (req, res) => {
    try {
      const code = String(req.query?.code || "").trim();
      const state = String(req.query?.state || "").trim(); // seller uid
      if (!code || !state) return res.status(400).send("Parâmetros inválidos.");

      const clientId = envFirst("MP_CLIENT_ID", "MERCADOPAGO_CLIENT_ID");
      const clientSecret = envFirst("MP_CLIENT_SECRET", "MERCADOPAGO_CLIENT_SECRET");
      const redirectUri = envFirst("MP_OAUTH_REDIRECT_URI", "MERCADOPAGO_OAUTH_REDIRECT_URI");
      if (!clientId || !clientSecret || !redirectUri) {
        return res.status(500).send("Configuração MP OAuth incompleta.");
      }

      const tokenResp = await axios.post(
        "https://api.mercadopago.com/oauth/token",
        {
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        },
        { timeout: 20000 }
      );

      const t = tokenResp?.data || {};
      const accessToken = String(t.access_token || "").trim();
      const refreshToken = String(t.refresh_token || "").trim();
      const expiresIn = Number(t.expires_in || 0);
      const mpUserId = t.user_id || null;

      if (!accessToken || !refreshToken) {
        return res.status(500).send("Falha ao conectar Mercado Pago (tokens vazios).");
      }

      const expiresAt = expiresIn ? (Date.now() + expiresIn * 1000) : 0;

      await db.collection("sellers").doc(state).set(
        {
          mp_access_token: accessToken,
          mp_refresh_token: refreshToken,
          mp_user_id: mpUserId,
          mp_token_expires_at: expiresAt,
          mp_connected: true,
          mp_connected_at: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return res.status(200).send(`<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conectado!</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;background:#0b1220;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
  .card{max-width:560px;width:100%;background:#111a2e;border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:22px}
  .btn{display:inline-block;margin-top:14px;background:#2563eb;color:#fff;text-decoration:none;padding:12px 14px;border-radius:12px;font-weight:800}
  .muted{opacity:.75;font-size:13px;margin-top:6px}
</style>
</head>
<body>
  <div class="card">
    <h2>✅ Mercado Pago conectado com sucesso!</h2>
    <p class="muted">Você já pode voltar para o painel do parceiro.</p>
    <a class="btn" href="/configuracoes_parceiro.html">Voltar para Configurações</a>
  </div>
</body>
</html>`);
    } catch (e) {
      const err = safeAxiosError(e);
      return res
        .status(500)
        .send("Erro ao conectar Mercado Pago: " + (err?.data?.message || err?.message || "unknown"));
    }
  });

  // ================= WEBHOOK MERCADO PAGO =================
  app.post("/webhooks/mercadopago", async (req, res) => {
  try {
    const paymentId = req.body?.data?.id || req.query?.id || req.body?.id || null;
    if (!paymentId) return res.sendStatus(200);

    async function fetchPayment(token) {
      return axios.get(`${MP_BASE}/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 20000,
      });
    }

    const platformToken = String(process.env.MP_ACCESS_TOKEN || "").trim();

    let p = null;
    let orderId = null;

    // 1) tenta token da plataforma (compatibilidade)
    if (platformToken) {
      try {
        const r = await fetchPayment(platformToken);
        p = r.data || null;
        orderId = p?.external_reference || null;
      } catch (_e) {}
    }

    // 2) se falhar, acha o pedido em orders pelo paymentId e usa token do seller
    if (!p) {
      const pidNum = Number(paymentId);
      const q1 = await db.collection("orders").where("payment.paymentId", "==", pidNum).limit(1).get();

      const docu = !q1.empty ? q1.docs[0] : null;
      if (docu) {
        orderId = docu.id;
        const d = docu.data() || {};
        const sellerId =
          d.sellerId ||
          d.sellerUid ||
          (Array.isArray(d.items) ? d.items?.[0]?.sellerId : null) ||
          null;

        const seller = await getSellerDocById(sellerId);
        const sellerToken = seller ? await refreshSellerTokenIfNeeded(seller) : "";
        if (sellerToken) {
          const r = await fetchPayment(sellerToken);
          p = r.data || null;
          orderId = p?.external_reference || orderId;
        }
      }
    }

    if (!p || !orderId) return res.sendStatus(200);

    const mpStatus = p.status;
    const orderStatus =
      mpStatus === "approved" ? "paid" :
      mpStatus === "pending" ? "pending_payment" :
      mpStatus === "in_process" ? "pending_payment" :
      mpStatus === "rejected" ? "payment_failed" :
      mpStatus === "cancelled" ? "cancelled" :
      mpStatus === "refunded" ? "refunded" :
      "pending_payment";

    await mergeOrder(orderId, {
      status: orderStatus,
      payment: {
        provider: "mercadopago",
        method: p.payment_method_id === "pix" ? "pix" : (p.payment_type_id === "ticket" ? "boleto" : "mp"),
        paymentId: p.id,
        status: p.status,
        statusDetail: p.status_detail || null,
        liveMode: !!p.live_mode,
      },
    });

    return res.sendStatus(200);
  } catch (_e) {
    return res.sendStatus(200);
  }
});

  // ================= MERCADO PAGO (PUBLIC KEY) =================
  // Frontend usa este endpoint para obter a Public Key (NUNCA exponha o Access Token no browser)
  app.get("/payments/mp/public_key", async (_req, res) => {
    try {
      const publicKey = envFirst("MP_PUBLIC_KEY", "MERCADOPAGO_PUBLIC_KEY", "MP_PUBLIC_KEY_PROD");
      if (!publicKey) {
        return res.status(400).json({ ok: false, error: "MP_PUBLIC_KEY não configurada" });
      }
      return res.json({ ok: true, publicKey });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "Erro ao obter Public Key", details: String(e?.message || e) });
    }
  });

  // ================= MERCADO PAGO (PIX) =================
  app.post("/payments/mp/pix", async (req, res) => {
    try {
      const body = req.body || {};
      const orderId = body.orderId;
      const amountRaw = body.amount;

      // aceita email em vários nomes (seu checkout manda "email")
      const payerEmail =
        body.payerEmail ||
        body.email ||
        body.payer?.email ||
        null;

      const ctx = await resolveSplitContext(orderId, amountRaw);
      // Venda da plataforma (Ariana): sem sellerId => usa token principal
      // Venda de seller: exige OAuth conectado
      const token = ctx.sellerId ? ctx.sellerToken : MP_PLATFORM_ACCESS_TOKEN;
      if (!token) {
        return res.status(400).json({ ok: false, error: ctx.sellerId ? "Seller ainda não conectou Mercado Pago (OAuth)" : "Mercado Pago da plataforma não configurado (MP_ACCESS_TOKEN)" });
      }
      const applicationFee = ctx.sellerId ? Number(ctx.applicationFee || 0) : 0;

      if (!orderId) return res.status(400).json({ ok: false, error: "orderId é obrigatório" });

      const amount = Number(ctx.transactionAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ ok: false, error: "amount é obrigatório e deve ser > 0" });
      }

      if (!payerEmail) {
        return res.status(400).json({ ok: false, error: "email (ou payerEmail) é obrigatório" });
      }

      // webhook do MP (notificação de status)
      const webhookUrl = `${publicBaseUrl(req)}/webhooks/mercadopago`;

      const mpResp = await axios.post(
        "https://api.mercadopago.com/v1/payments",
        {
          transaction_amount: amount,
          application_fee: applicationFee || undefined,
          description: `Ariana Moveis - Pedido ${orderId}`,
          payment_method_id: "pix",
          payer: { email: payerEmail },
          external_reference: orderId,
          notification_url: webhookUrl,
        },
        mpHeaders(token, req, `${orderId}-pix-${amount.toFixed(2)}`)
      
      );

      await mergeOrder(orderId, {
        sellerId: ctx.sellerId || null,
        status: "pending_payment",
        payment: {
          provider: "mercadopago",
          method: "pix",
          paymentId: mpResp.data.id,
          status: mpResp.data.status,
          applicationFee: applicationFee || 0,
          liveMode: !!mpResp.data.live_mode,
        },
      });

      res.json({

        ok: true,
        qrCode: mpResp.data.point_of_interaction?.transaction_data?.qr_code,
        qrCodeBase64: mpResp.data.point_of_interaction?.transaction_data?.qr_code_base64,
        ticketUrl: mpResp.data.point_of_interaction?.transaction_data?.ticket_url,
        paymentId: mpResp.data.id,
        status: mpResp.data.status,
        liveMode: !!mpResp.data.live_mode,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: "Erro MP", details: e.response?.data || e.message });
    }
  });

  // ================= MERCADO PAGO (BOLETO) =================
  app.post("/payments/mp/boleto", async (req, res) => {
    try {
      const orderId = req.body?.orderId;
      const amount = req.body?.amount;
      const payerEmail = req.body?.payerEmail || req.body?.email;
      const payerName = req.body?.payerName || req.body?.name || "Cliente";

      const cpfRaw =
        req.body?.cpf ||
        req.body?.CPF ||
        req.body?.payer?.identification?.number ||
        req.body?.payerCpf ||
        req.body?.document ||
        req.body?.cpfCliente ||
        null;

      const cpf = cpfRaw;

      const ctx = await resolveSplitContext(orderId, amount);
      const token = ctx.sellerId ? ctx.sellerToken : MP_PLATFORM_ACCESS_TOKEN;
      if (!token) {
        return res.status(400).json({ ok: false, error: ctx.sellerId ? "Seller ainda não conectou Mercado Pago (OAuth)" : "Mercado Pago da plataforma não configurado (MP_ACCESS_TOKEN)" });
      }
      const applicationFee = ctx.sellerId ? Number(ctx.applicationFee || 0) : 0;
if (!orderId) return res.status(400).json({ ok: false, error: "orderId é obrigatório" });
      if (amount === undefined || amount === null || Number(amount) <= 0) {
        return res.status(400).json({ ok: false, error: "amount é obrigatório e deve ser > 0" });
      }
      if (!payerEmail) return res.status(400).json({ ok: false, error: "payerEmail (ou email) é obrigatório" });

      const webhookUrl = `${publicBaseUrl(req)}/webhooks/mercadopago`;

      // DEBUG leve
      if (!cpf) {
        try {
          const keys = req.body ? Object.keys(req.body) : [];
          console.log("[MP BOLETO] cpf ausente. content-type=", req.get("content-type"), "keys=", keys);
        } catch (_e) {}
        return res.status(400).json({ ok: false, error: "cpf é obrigatório" });
      }

      const cpfDigits = String(cpf).replace(/\D/g, "");
      if (cpfDigits.length !== 11) return res.status(400).json({ ok: false, error: "cpf inválido (11 dígitos)" });

      const nameParts = splitFullName(payerName);

      // Endereço do pagador (MP pode exigir para boleto registrado)
      const addr = extractBoletoAddress(req.body);
      if (!addr.ok) {
        return res.status(400).json({
          ok: false,
          error: "Endereço do pagador é obrigatório para boleto registrado",
          missing: addr.missing,
          hint: {
            exemplo: {
              payerName: "Comprador Teste",
              payerEmail: "teste@teste.com",
              cpf: "19119119100",
              address: {
                zip_code: "01310930",
                street_name: "Av Paulista",
                street_number: "1000",
                neighborhood: "Bela Vista",
                city: "São Paulo",
                federal_unit: "SP",
              },
            },
          },
        });
      }

      const idemKey = makeIdempotencyKey(req, `${orderId}-boleto-${Number(amount).toFixed(2)}-${cpfDigits}`);

      const mpResp = await axios.post(
        "https://api.mercadopago.com/v1/payments",
        {
          transaction_amount: Number(amount),
          description: `Ariana Moveis - Pedido ${orderId} (Boleto)`,
          payment_method_id: "bolbradesco",
          payer: {
            email: payerEmail,
            first_name: nameParts.first,
            last_name: nameParts.last,
            identification: { type: "CPF", number: cpfDigits },
            address: addr.address,
          },
          external_reference: orderId,
          notification_url: webhookUrl,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "X-Idempotency-Key": idemKey,
          },
          timeout: 30000,
        }
      );

      const p = mpResp.data || {};

      res.json({
        ok: true,
        paymentId: p.id,
        status: p.status,
        statusDetail: p.status_detail || null,
        ticketUrl: p.transaction_details?.external_resource_url || null,
        digitableLine: p.barcode?.content || p.barcode || null,
        idempotencyKeyUsed: idemKey,
        raw: p,
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: "Erro MP BOLETO",
        details: e.response?.data || e.message,
      });
    }
  });

  // ================= MERCADO PAGO (CREDIT CARD) =================
  // OBS: Esta rota é necessária para o front pagar com cartão via Mercado Pago (sem Cielo).
  // O front deve enviar: orderId, amount, email, name, cpf + token (MP SDK), payment_method_id, issuer_id (opcional), installments.
  app.post("/payments/mp/credit", async (req, res) => {
    try {
      const body = req.body || {};
      const orderId = body.orderId;

      // Valores do cartão (tokenizados no browser via MP SDK)
      const tokenCard = body.token; // obrigatório
      const paymentMethodId = body.payment_method_id; // ex: "visa"
      const issuerId = body.issuer_id || undefined;
      const installments = Number(body.installments || 1);

      const payerEmail = body.payerEmail || body.email || body.payer?.email || null;
      const payerName = body.payerName || body.name || "Cliente";

      const cpfRaw =
        body.cpf ||
        body.CPF ||
        body.payer?.identification?.number ||
        body.payerCpf ||
        body.document ||
        body.cpfCliente ||
        null;

      const ctx = await resolveSplitContext(orderId, body.amount);
      const token = ctx.sellerId ? ctx.sellerToken : MP_PLATFORM_ACCESS_TOKEN;
      if (!token) {
        return res.status(400).json({ ok: false, error: ctx.sellerId ? "Seller ainda não conectou Mercado Pago (OAuth)" : "Mercado Pago da plataforma não configurado (MP_ACCESS_TOKEN)" });
      }
      const applicationFee = ctx.sellerId ? Number(ctx.applicationFee || 0) : 0;
if (!orderId) return res.status(400).json({ ok: false, error: "orderId é obrigatório" });

      const amount = Number(ctx.transactionAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ ok: false, error: "amount é obrigatório e deve ser > 0" });
      }

      if (!payerEmail) return res.status(400).json({ ok: false, error: "email (ou payerEmail) é obrigatório" });

      if (!tokenCard) return res.status(400).json({ ok: false, error: "token (cartão) é obrigatório" });
      if (!paymentMethodId) return res.status(400).json({ ok: false, error: "payment_method_id é obrigatório" });

      if (!cpfRaw) return res.status(400).json({ ok: false, error: "cpf é obrigatório" });

      const cpfDigits = String(cpfRaw).replace(/\D/g, "");
      if (cpfDigits.length !== 11) return res.status(400).json({ ok: false, error: "cpf inválido (11 dígitos)" });

      const webhookUrl = `${publicBaseUrl(req)}/webhooks/mercadopago`;

      const idemKey = makeIdempotencyKey(req, `${orderId}-credit-${amount.toFixed(2)}-${cpfDigits}`);

      const mpResp = await axios.post(
        "https://api.mercadopago.com/v1/payments",
        {
          transaction_amount: amount,
          application_fee: applicationFee || undefined,
          token: tokenCard,
          description: `Ariana Moveis - Pedido ${orderId} (Cartão)`,
          installments,
          payment_method_id: paymentMethodId,
          issuer_id: issuerId,
          payer: {
            email: payerEmail,
            first_name: splitFullName(payerName).first,
            last_name: splitFullName(payerName).last,
            identification: { type: "CPF", number: cpfDigits },
          },
          external_reference: String(orderId),
          notification_url: webhookUrl,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "X-Idempotency-Key": idemKey,
          },
          timeout: 30000,
        }
      );

      const p = mpResp.data || {};

      // (Opcional) salva em Firestore já no momento da criação
      await mergeOrder(orderId, {
        status: "pending_payment",
        payment: {
          provider: "mercadopago",
          method: "credit_card",
          paymentId: p.id,
          status: p.status,
          statusDetail: p.status_detail || null,
          liveMode: !!p.live_mode,
        },
      });

      return res.json({
        ok: true,
        paymentId: p.id,
        status: p.status,
        statusDetail: p.status_detail || null,
        idempotencyKeyUsed: idemKey,
        liveMode: !!p.live_mode,
        raw: p,
      });
    } catch (e) {
      return res.status(e?.response?.status || 500).json({
        ok: false,
        error: "Erro MP CREDIT",
        details: e?.response?.data || e?.message || String(e),
      });
    }
  });

  // Compatibilidade: se algum front antigo chamar /mp/credit
  app.post("/mp/credit", (req, res) => {
    req.url = "/payments/mp/credit";
    return app(req, res);
  });

  // ================= MERCADO PAGO (STATUS) =================
  app.get("/payments/mp/status/:paymentId", async (req, res) => {
    try {
      const token = String(process.env.MP_ACCESS_TOKEN || "").trim();
      if (!token) return res.status(500).json({ ok: false, error: "MP_ACCESS_TOKEN não configurado" });

      const paymentId = String(req.params.paymentId || "").trim();
      if (!paymentId) return res.status(400).json({ ok: false, error: "paymentId é obrigatório" });

      const r = await axios.get(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 20000,
      });

      const d = r.data || {};
      res.json({
        ok: true,
        paymentId: d.id,
        externalReference: d.external_reference || null,
        status: d.status || null,
        statusDetail: d.status_detail || null,
        amount: d.transaction_amount ?? null,
        dateCreated: d.date_created || null,
        dateApproved: d.date_approved || null,
        paymentMethodId: d.payment_method_id || null,
        paymentTypeId: d.payment_type_id || null,
        raw: d,
      });
    } catch (e) {
      const err = safeAxiosError(e);
      res.status(err.status || 500).json({
        ok: false,
        stage: "payments/mp/status",
        error: "Erro MP",
        status: err.status,
        details: err.data || err.message,
      });
    }
  });

  // ================= CORREIOS =================
  let tokenCache = { token: null, exp: 0 };

  function correiosCfg() {
    const user = envFirst("CORREIOS_USER");
    const pass = envFirst("CORREIOS_PASS");
    const cartao = envFirst("CORREIOS_CARTAO");
    const contrato = envFirst("CORREIOS_CONTRATO");
    const dr = envFirst("CORREIOS_DR") || "0";
    const originCep = envFirst("LOJA_ORIGEM_CEP");
    const services = parseServices(envFirst("CORREIOS_SERVICOS"));

    return {
      user,
      pass,
      cartao,
      contrato,
      dr,
      originCep,
      services,
      tokenUrl: "https://api.correios.com.br/token/v1/autentica/cartaopostagem",
      precoUrl: "https://api.correios.com.br/preco/v1/nacional",
    };
  }

  app.get("/debug/correios", (_req, res) => {
    const cfg = correiosCfg();
    res.json({
      CORREIOS_USER: cfg.user ? "OK" : "MISSING",
      CORREIOS_PASS: cfg.pass ? "OK" : "MISSING",
      CORREIOS_CARTAO: cfg.cartao ? "OK" : "MISSING",
      CORREIOS_CONTRATO: cfg.contrato ? "OK" : "MISSING",
      CORREIOS_DR: cfg.dr || "0",
      CORREIOS_SERVICOS: (cfg.services || []).join(","),
      LOJA_ORIGEM_CEP: cfg.originCep ? "OK" : "MISSING",
    });
  });

  app.get("/debug/correios-secret-fingerprint", (_req, res) => {
    const user = String(process.env.CORREIOS_USER || "");
    const pass = String(process.env.CORREIOS_PASS || "");

    const last10 = pass.slice(-10);
    const last10Codes = Array.from(last10).map((ch) => ch.charCodeAt(0));

    res.json({
      CORREIOS_USER_len: user.length,
      CORREIOS_PASS_len: pass.length,
      pass_has_newline: pass.includes("\n") || pass.includes("\r"),
      pass_has_space_edges: pass !== pass.trim(),
      pass_last4: pass.slice(-4),
      pass_last10_codes: last10Codes,
    });
  });

  async function getCorreiosToken() {
    const cfg = correiosCfg();
    const now = Date.now();

    if (tokenCache.token && tokenCache.exp > now) return tokenCache.token;

    const user = String(cfg.user || "").trim();
    const pass = String(cfg.pass || "").trim();

    if (!user || !pass) throw new Error("Correios: CORREIOS_USER/CORREIOS_PASS ausentes.");
    if (!cfg.cartao) throw new Error("Correios: CORREIOS_CARTAO ausente.");

    const auth = Buffer.from(`${user}:${pass}`).toString("base64");

    const body = {
      numero: cfg.cartao,
      contrato: cfg.contrato || undefined,
      dr: cfg.dr ? Number(cfg.dr) : undefined,
    };

    const r = await axios.post(cfg.tokenUrl, body, {
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: 20000,
    });

    const expiresIn = Number(r.data?.expires_in || 3000);
    const token = r.data?.token;
    if (!token) throw new Error("Correios: token não retornou.");

    tokenCache.token = token;
    tokenCache.exp = now + Math.max(60, expiresIn - 60) * 1000;
    return tokenCache.token;
  }

  app.get("/correios/token-test", async (_req, res) => {
    try {
      const token = await getCorreiosToken();
      res.json({ ok: true, tokenPreview: token.slice(0, 16) + "..." });
    } catch (e) {
      const err = safeAxiosError(e);
      res.status(500).json({
        ok: false,
        stage: "token",
        status: err.status,
        error: err.message,
        correios: err.data,
      });
    }
  });

  // Endpoint: quotes + errors (+ name)
  app.post("/shipping/correios/quote", async (req, res) => {
    try {
      const cfg = correiosCfg();
      const token = await getCorreiosToken();

      const cepOrigem = normalizeDigits(cfg.originCep);
      const cepDestino = normalizeDigits(req.body.cepDestino);

      if (cepOrigem.length !== 8) return res.status(400).json({ ok: false, error: "LOJA_ORIGEM_CEP inválido (8 dígitos)" });
      if (cepDestino.length !== 8) return res.status(400).json({ ok: false, error: "cepDestino inválido (8 dígitos)" });

      const psObjeto = toGrams(req.body.pesoKg);
      if (!psObjeto) return res.status(400).json({ ok: false, error: "pesoKg inválido (ex: 0.3, 1, 2.5)" });

      // ===== LIMITES (regras do seu projeto) =====
      const pesoKgNum = Number(req.body.pesoKg);
      if (!Number.isFinite(pesoKgNum) || pesoKgNum <= 0) {
        return res.status(400).json({ ok: false, error: "pesoKg inválido (ex: 0.3, 1, 2.5)" });
      }

      // Correios: até 30kg
      if (pesoKgNum > 30) {
        return res.json({
          ok: true,
          quotes: [],
          errors: [{ code: "CORREIOS_LIMIT_WEIGHT", message: "Correios: limite máximo de 30kg." }],
          meta: { cepOrigem, cepDestino, pesoKg: pesoKgNum, limits: { maxWeightKg: 30, maxSideCm: 100 } },
          bestQuote: null,
        });
      }

      // aceita faltar largura/altura: aplica default seguro
      let comprimento = positiveIntOrNull(req.body.comprimento);
      let largura = positiveIntOrNull(req.body.largura);
      let altura = positiveIntOrNull(req.body.altura);

      const hasAnyDim = !!(comprimento || largura || altura);
      if (hasAnyDim) {
        if (!comprimento) comprimento = "11";
        if (!largura) largura = "11";
        if (!altura) altura = "2";
      }

      const hasDims = !!(comprimento && largura && altura);

      // Correios: maior lado até 100cm (quando houver dimensões)
      if (hasDims) {
        const maxSide = Math.max(Number(comprimento), Number(largura), Number(altura));
        if (Number.isFinite(maxSide) && maxSide > 100) {
          return res.json({
            ok: true,
            quotes: [],
            errors: [{ code: "CORREIOS_LIMIT_SIZE", message: "Correios: maior lado acima de 100cm (limite do seu site)." }],
            meta: {
              cepOrigem,
              cepDestino,
              pesoKg: pesoKgNum,
              dimensionsUsed: { comprimento: Number(comprimento), largura: Number(largura), altura: Number(altura) },
              limits: { maxWeightKg: 30, maxSideCm: 100 },
            },
            bestQuote: null,
          });
        }
      }
      const tpObjeto = hasDims ? "2" : "1";
      const idLote = String(Date.now());

      const parametrosProduto = cfg.services.map((coProduto, idx) => {
        const item = {
          coProduto: String(coProduto),
          nuRequisicao: String(idx + 1).padStart(4, "0"),
          cepOrigem,
          cepDestino,
          psObjeto,
          tpObjeto,
          nuUnidade: "",
        };

        if (cfg.contrato) item.nuContrato = String(cfg.contrato);
        const drNum = Number(cfg.dr);
        if (Number.isFinite(drNum) && drNum > 0) item.nuDR = drNum;

        if (tpObjeto === "2") {
          item.comprimento = comprimento;
          item.largura = largura;
          item.altura = altura;
        }
        return item;
      });

      const r = await axios.post(
        cfg.precoUrl,
        { idLote, parametrosProduto },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          timeout: 20000,
        }
      );

      const rawList =
        Array.isArray(r.data) ? r.data :
        Array.isArray(r.data?.itens) ? r.data.itens :
        Array.isArray(r.data?.resultado) ? r.data.resultado :
        Array.isArray(r.data?.parametrosProduto) ? r.data.parametrosProduto :
        (r.data ? [r.data] : []);

      const quotes = [];
      const errors = [];

      for (const item of rawList) {
        const coProduto = String(item?.coProduto || "");
        const txErro = item?.txErro ? String(item.txErro) : "";

        if (txErro) {
          errors.push({
            service: coProduto,
            name: SERVICE_NAMES[coProduto] || coProduto,
            message: txErro,
            raw: item,
          });
          continue;
        }

        const price = pickPrice(item);
        const deadlineDays = pickDeadline(item);

        quotes.push({
          service: coProduto,
          name: SERVICE_NAMES[coProduto] || coProduto,
          price,
          deadlineDays,
          raw: item,
        });
      }

      // Frete grátis "Ariana Móveis" SOMENTE local e SOMENTE quando o pedido é Ariana
      const isArianaFulfillment =
        req.body?.isArianaOrder === true ||
        req.body?.fulfillment === "ARIANA" ||
        req.body?.soldBy === "ARIANA" ||
        req.body?.deliveredBy === "ARIANA";

      if (isArianaFulfillment && cepOrigem === "39740000" && cepDestino === "39740000") {
        quotes.unshift({
          service: "ARIANA_FREE",
          name: "Ariana Móveis",
          price: 0,
          deadlineDays: 0,
          raw: { note: "Frete grátis local (39740000 -> 39740000)" },
        });
      }

      quotes.sort((a, b) => {
        const ap = a.price ?? Number.POSITIVE_INFINITY;
        const bp = b.price ?? Number.POSITIVE_INFINITY;
        return ap - bp;
      });

      res.json({
        ok: true,
        quotes,
        errors,
        bestQuote: quotes[0] || null,
        meta: {
          cepOrigem,
          cepDestino,
          pesoKg: pesoKgNum,
          dimensionsUsed: hasDims
            ? { comprimento: Number(comprimento), largura: Number(largura), altura: Number(altura) }
            : null,
          servicesRequested: cfg.services,
          limits: { maxWeightKg: 30, maxSideCm: 100 },
        },
      });
    } catch (e) {
      const err = safeAxiosError(e);
      res.status(500).json({
        ok: false,
        error: "Erro Correios",
        status: err.status,
        details: err.message,
        correios: err.data,
      });
    }
  });

  

  // ================= LOGÍSTICAS (TRANSPORTADORAS) =================
  // Endpoint separado para consultar transportadoras via cubagem do carrinho
  // NÃO interfere com /shipping/correios/quote

  function calculateVirtualBox(items = [], margin = 0.10) {
    let totalVolumeCm3 = 0;
    let totalWeightKg = 0;

    for (const raw of items) {
      const item = raw || {};
      const qty = Number(item.quantity ?? item.qty ?? 1);

      const c = Number(item.comprimento ?? item.length ?? 0);
      const l = Number(item.largura ?? item.width ?? 0);
      const a = Number(item.altura ?? item.height ?? 0);
      const peso = Number(item.pesoKg ?? item.weightKg ?? 0);

      if (Number.isFinite(c) && Number.isFinite(l) && Number.isFinite(a) && c > 0 && l > 0 && a > 0) {
        totalVolumeCm3 += (c * l * a) * (Number.isFinite(qty) && qty > 0 ? qty : 1);
      }

      if (Number.isFinite(peso) && peso > 0) {
        totalWeightKg += peso * (Number.isFinite(qty) && qty > 0 ? qty : 1);
      }
    }

    // margem de segurança (padrão 10%)
    const m = Number(margin);
    const safeMargin = Number.isFinite(m) && m >= 0 ? m : 0.10;
    totalVolumeCm3 *= (1 + safeMargin);

    // Se não houver dimensões (volume = 0), devolve mínimos seguros
    if (!Number.isFinite(totalVolumeCm3) || totalVolumeCm3 <= 0) {
      return {
        comprimento: 11,
        largura: 11,
        altura: 2,
        pesoKg: Number(totalWeightKg.toFixed(2)) || 0.3,
        meta: { reason: "missing_dimensions" },
      };
    }

    // "caixa virtual" aproximada: cubo com aresta = raiz cúbica do volume
    const side = Math.cbrt(totalVolumeCm3);

    return {
      comprimento: Math.max(1, Math.ceil(side)),
      largura: Math.max(1, Math.ceil(side)),
      altura: Math.max(1, Math.ceil(side)),
      pesoKg: Number(totalWeightKg.toFixed(2)) || 0.3,
      meta: { volumeCm3: Math.round(totalVolumeCm3), margin: safeMargin },
    };
  }

  // Stub: aqui você conecta Frenet / Melhor Envio / Intelipost etc.
  

  // ================= ENTREGA PRÓPRIA (RAIO 150km) =================
  // Regra: calcula distância aproximada por CEP e aplica sua tabela:
  // 0–50 km  -> R$ 89
  // 51–120km -> R$ 159
  // 121–200km-> R$ 211
  // 121–150km-> R$ 259
  //
  // Observação:
  // - Primeiro tentamos coordenadas via BrasilAPI (CEP v2). Se não vier, usamos ViaCEP + Nominatim (cidade/UF) como fallback.
  // - A distância padrão é Haversine (linha reta). Se você configurar OPENROUTE_API_KEY, usamos rota real (driving-car).
  //
  // Para reduzir custo/limite, guardamos coordenadas em cache no Firestore: coleção "_geo_cache".
  const OWN_DELIVERY_MAX_KM = 150;
  const OWN_DELIVERY_PRICING = [
    { maxKm: 50, price: 89 },
    { maxKm: 120, price: 159 },
    { maxKm: 150, price: 211 },
  ];

  function haversineKm(a, b) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const R = 6371; // km
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);

    const x =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    return R * c;
  }

  async function getGeoFromCache(key) {
    try {
      const snap = await db.collection("_geo_cache").doc(key).get();
      if (!snap.exists) return null;
      const d = snap.data() || {};
      if (typeof d.lat !== "number" || typeof d.lon !== "number") return null;
      return { lat: d.lat, lon: d.lon, city: d.city || null, uf: d.uf || null, source: d.source || "cache" };
    } catch (_e) {
      return null;
    }
  }

  async function setGeoCache(key, geo) {
    try {
      await db.collection("_geo_cache").doc(key).set(
        {
          lat: geo.lat,
          lon: geo.lon,
          city: geo.city || null,
          uf: geo.uf || null,
          source: geo.source || "unknown",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (_e) {
      // cache é "best effort"
    }
  }

  async function geoFromBrasilApi(cepDigits) {
    const url = `https://brasilapi.com.br/api/cep/v2/${encodeURIComponent(cepDigits)}`;
    const r = await axios.get(url, { timeout: 12000 });
    const d = r?.data || {};
    const loc = d.location || d.location?.coordinates ? d.location : null;

    // BrasilAPI costuma retornar:
    // location: { type: "Point", coordinates: { longitude, latitude } }
    const lon = Number(loc?.coordinates?.longitude);
    const lat = Number(loc?.coordinates?.latitude);

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return {
        lat,
        lon,
        city: d.city || d.localidade || null,
        uf: d.state || d.uf || null,
        source: "brasilapi",
      };
    }
    return null;
  }

  async function geoFromViaCep(cepDigits) {
    const r = await axios.get(`https://viacep.com.br/ws/${encodeURIComponent(cepDigits)}/json/`, { timeout: 12000 });
    const d = r?.data || {};
    if (d?.erro) return null;
    const city = String(d.localidade || "").trim();
    const uf = String(d.uf || "").trim();

    if (!city || !uf) return null;

    // Fallback de geocodificação sem chave: Nominatim (OpenStreetMap)
    // (Use cache para não bater muito.)
    const q = `${city}, ${uf}, Brazil`;
    const geo = await axios.get("https://nominatim.openstreetmap.org/search", {
      params: { q, format: "json", limit: 1 },
      headers: { "User-Agent": "ArianaMoveis/1.0 (shipping-geo)" },
      timeout: 15000,
    });

    const arr = Array.isArray(geo?.data) ? geo.data : [];
    const first = arr[0] || null;
    const lat = Number(first?.lat);
    const lon = Number(first?.lon);

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { lat, lon, city, uf, source: "viacep+nominatim" };
    }
    return null;
  }

  async function getGeoByCep(cepDigits) {
    const key = `cep_${cepDigits}`;
    const cached = await getGeoFromCache(key);
    if (cached) return cached;

    // 1) BrasilAPI (preferido)
    try {
      const g1 = await geoFromBrasilApi(cepDigits);
      if (g1) {
        await setGeoCache(key, g1);
        return g1;
      }
    } catch (_e) {}

    // 2) ViaCEP + Nominatim (fallback)
    try {
      const g2 = await geoFromViaCep(cepDigits);
      if (g2) {
        await setGeoCache(key, g2);
        return g2;
      }
    } catch (_e) {}

    return null;
  }

  async function distanceInfoByCep(originCepDigits, destCepDigits) {
    const cacheKey = `dist_${originCepDigits}_${destCepDigits}`;
    // cache de distância (best effort)
    try {
      const snap = await db.collection("_geo_cache").doc(cacheKey).get();
      if (snap.exists) {
        const d = snap.data() || {};
        if (typeof d.distanceKm === "number" && Number.isFinite(d.distanceKm) && d.distanceKm > 0) {
          return { km: d.distanceKm, source: (d.source || "cache") };
        }
      }
    } catch (_e) {}

    const og = await getGeoByCep(originCepDigits);
    const dg = await getGeoByCep(destCepDigits);
    if (!og || !dg) return null;

    // Se você configurar OPENROUTE_API_KEY, usamos rota real (melhor para 260km).
    const orsKey = String(process.env.OPENROUTE_API_KEY || "").trim();
    if (orsKey) {
      try {
        const route = await axios.post(
          "https://api.openrouteservice.org/v2/directions/driving-car",
          { coordinates: [[og.lon, og.lat], [dg.lon, dg.lat]] },
          {
            headers: { Authorization: orsKey, "Content-Type": "application/json" },
            timeout: 20000,
          }
        );
        const meters = route?.data?.routes?.[0]?.summary?.distance;
        const km = typeof meters === "number" && meters > 0 ? meters / 1000 : null;
        if (km) {
          try {
            await db.collection("_geo_cache").doc(cacheKey).set(
              { distanceKm: km, source: "openrouteservice", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
              { merge: true }
            );
          } catch (_e) {}
          return { km, source: "openroute" };
        }
      } catch (_e) {
        // cai no haversine
      }
    }

    const km = haversineKm({ lat: og.lat, lon: og.lon }, { lat: dg.lat, lon: dg.lon });
    try {
      await db.collection("_geo_cache").doc(cacheKey).set(
        { distanceKm: km, source: "haversine", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    } catch (_e) {}
    return { km, source: "haversine" };
  }

  async function distanceKmByCep(originCepDigits, destCepDigits) {
    const info = await distanceInfoByCep(originCepDigits, destCepDigits);
    return info ? info.km : null;
  }

  function ownDeliveryPriceByKm(km) {
    for (const tier of OWN_DELIVERY_PRICING) {
      if (km <= tier.maxKm) return tier.price;
    }
    return null;
  }

  function ownDeliveryDeadlineDaysByKm(km) {
    if (km <= 50) return 1;
    if (km <= 120) return 2;
    if (km <= 200) return 2;
    return 3; // 201–260
  }

  async function buildOwnDeliveryQuote(cepOrigem, cepDestino) {
    const dist = await distanceInfoByCep(cepOrigem, cepDestino);
    const km = dist ? dist.km : null;
    const distanceSource = dist ? dist.source : null;
    if (!Number.isFinite(km) || km <= 0) return null;
    if (km > OWN_DELIVERY_MAX_KM) return null;

    const price = ownDeliveryPriceByKm(km);
    if (price === null) return null;

    return {
      service: "ENTREGA_PROPRIA",
      name: "Entrega Ariana Móveis",
      price,
      deadlineDays: ownDeliveryDeadlineDaysByKm(km),
      meta: { distanceKm: Math.round(km * 10) / 10, distanceSource },
    };
  }

async function quoteTransportadoras(_payload) {
    // Retorne uma lista no formato:
    // [{ service: "JADLOG", name: "Jadlog", price: 39.9, deadlineDays: 4, raw: {...} }, ...]
    return [];
  }

  // Endpoint: calcula cubagem do carrinho e consulta transportadoras
  app.post("/shipping/logistics/quote", async (req, res) => {
    try {
      const cfg = correiosCfg(); // reaproveita LOJA_ORIGEM_CEP
      const cepOrigem = normalizeDigits(cfg.originCep);
      const cepDestino = normalizeDigits(req.body?.cepDestino);

      if (cepOrigem.length !== 8) {
        return res.status(400).json({ ok: false, error: "LOJA_ORIGEM_CEP inválido (8 dígitos)" });
      }
      if (cepDestino.length !== 8) {
        return res.status(400).json({ ok: false, error: "cepDestino inválido (8 dígitos)" });
      }

      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      if (items.length === 0) {
        return res.status(400).json({ ok: false, error: "items é obrigatório (array)" });
      }

      const margin = req.body?.margin;
      const box = calculateVirtualBox(items, margin);

      const payload = {
        cepOrigem,
        cepDestino,
        box,
        items,
      };

      const enableOwnDelivery = req.body?.enableOwnDelivery !== false;

      const quotesTransportadoras = await quoteTransportadoras(payload);
      const quotes = [];

      // 1) Entrega própria (até 260km) - se habilitada
      if (enableOwnDelivery) {
        try {
          const own = await buildOwnDeliveryQuote(cepOrigem, cepDestino);
          if (own) quotes.push(own);
        } catch (_e) {
          // não quebra a cotação se a distância falhar
        }
      }

      // 2) Transportadoras (stub / integrações futuras)
      if (Array.isArray(quotesTransportadoras) && quotesTransportadoras.length) {
        quotes.push(...quotesTransportadoras);
      }

      // Ordena por menor preço
      quotes.sort((a, b) => {
        const ap = typeof a?.price === "number" ? a.price : Number.POSITIVE_INFINITY;
        const bp = typeof b?.price === "number" ? b.price : Number.POSITIVE_INFINITY;
        return ap - bp;
      });

      return res.json({
        ok: true,
        cepOrigem,
        cepDestino,
        box,
        quotes,
        bestQuote: quotes[0] || null,
      });
    } catch (e) {
      const err = safeAxiosError(e);
      return res.status(500).json({
        ok: false,
        error: "Erro ao consultar transportadoras",
        status: err.status,
        details: err.message,
        data: err.data,
      });
    }
  });

// ================= reCAPTCHA (Enterprise) - Update Phone =================
  function getProjectId() {
    return (
      process.env.GCLOUD_PROJECT ||
      process.env.GCP_PROJECT ||
      (() => {
        try {
          const cfg = JSON.parse(process.env.FIREBASE_CONFIG || "{}");
          return cfg.projectId || "";
        } catch (_e) {
          return "";
        }
      })()
    );
  }

  async function verifyRecaptchaEnterprise(token, action) {
    const apiKey = envFirst("RECAPTCHA_API_KEY", "RECAPTCHA_ENTERPRISE_API_KEY");
    const siteKey = envFirst("RECAPTCHA_SITE_KEY", "RECAPTCHA_ENTERPRISE_SITE_KEY");
    const projectId = getProjectId();

    if (!apiKey || !siteKey || !projectId) {
      return { ok: false, reason: "missing_config" };
    }
    if (!token) return { ok: false, reason: "missing_token" };

    const url = `https://recaptchaenterprise.googleapis.com/v1/projects/${projectId}/assessments?key=${encodeURIComponent(
      apiKey
    )}`;

    try {
      const resp = await axios.post(
        url,
        {
          event: {
            token,
            siteKey,
            expectedAction: action,
          },
        },
        { timeout: 10000 }
      );

      const data = resp?.data || {};
      const tokenProps = data?.tokenProperties || {};
      const risk = data?.riskAnalysis || {};
      const valid = tokenProps?.valid === true;
      const reason = tokenProps?.invalidReason || null;
      const score = typeof risk?.score === "number" ? risk.score : null;
      const actionMatched = tokenProps?.action ? tokenProps.action === action : true;

      return { ok: Boolean(valid && actionMatched), valid, actionMatched, score, invalidReason: reason };
    } catch (e) {
      const err = safeAxiosError(e);
      return { ok: false, reason: "request_failed", err };
    }
  }

  // Atualiza telefone com proteção reCAPTCHA + Auth
  app.post("/account/update-phone", async (req, res) => {
    try {
      const authHeader = String(req.get("authorization") || "");
      const m = authHeader.match(/^Bearer\s+(.+)$/i);
      const idToken = m ? m[1] : null;
      if (!idToken) return res.status(401).json({ ok: false, error: "missing_auth" });

      const decoded = await admin.auth().verifyIdToken(idToken);
      const uid = decoded?.uid;
      if (!uid) return res.status(401).json({ ok: false, error: "invalid_auth" });

      const phoneRaw = String(req.body?.phone || "").trim();
      const phone = normalizeDigits(phoneRaw);
      if (!phone || phone.length < 10) {
        return res.status(400).json({ ok: false, error: "phone_invalid" });
      }

      const recaptchaToken = String(req.body?.recaptchaToken || "").trim();
      const check = await verifyRecaptchaEnterprise(recaptchaToken, "UPDATE_PHONE");
      if (!check.ok) {
        return res.status(403).json({ ok: false, error: "recaptcha_failed", check });
      }

      await db.collection("users").doc(uid).set(
        {
          phone,
          phoneUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return res.json({ ok: true, uid, phone });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "update_phone_failed", details: String(e?.message || e) });
    }
  });

  // =========================================================
  // SELLER - Reset de senha via SendGrid (entregabilidade melhor)
  // Endpoint final no cliente: POST /api/auth/seller/reset-password
  // =========================================================
  app.post("/auth/seller/reset-password", async (req, res) => {
    try {
      const email = (req.body?.email || "").toString().trim().toLowerCase();
      if (!email) return res.status(400).json({ ok: false, error: "Email obrigatório" });

      // Se SendGrid não estiver configurado, devolve erro claro (para debug)
      if (!SENDGRID_API_KEY || !EMAIL_FROM) {
        return res.status(500).json({
          ok: false,
          error:
            "SendGrid não configurado. Verifique secrets SENDGRID_API_KEY e EMAIL_FROM no deploy da function.",
        });
      }

      // Segurança: só envia se existir em /sellers com esse email
      // (evita abuso e vazamento: resposta é sempre ok)
      let sellerOk = false;
      try {
        const snap = await db
          .collection("sellers")
          .where("email", "==", email)
          .limit(1)
          .get();
        if (!snap.empty) {
          const seller = snap.docs[0].data() || {};
          const active = (seller.active ?? seller.ativo ?? true) === true;
          const status = (seller.status || "").toString().toLowerCase();
          sellerOk = active && (!status || status === "aprovado" || status === "approved");
        }
      } catch (e) {
        console.warn("[seller reset] Falha ao consultar sellers:", e);
        // Se rules bloquear, ainda assim não vaza; mas não conseguimos validar seller
        sellerOk = true; // permite enviar
      }

      // Para não vazar se email existe, sempre retornamos ok
      if (!sellerOk) {
        return res.json({ ok: true, message: "Se o e-mail existir, enviaremos instruções." });
      }

      const resetLink = await admin.auth().generatePasswordResetLink(email, {
        url: RESET_CONTINUE_URL,
        handleCodeInApp: false,
      });

      await sgMail.send({
        to: email,
        from: EMAIL_FROM,
        subject: "Redefinição de senha • Ariana Móveis (Seller)",
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
            <h2 style="margin:0 0 12px 0;">Redefinir senha</h2>
            <p style="margin:0 0 16px 0;">
              Recebemos uma solicitação para redefinir sua senha de acesso ao Painel do Seller.
            </p>
            <p style="margin:0 0 16px 0;">
              <a href="${resetLink}"
                 style="display:inline-block;background:#2b5c88;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:bold">
                Redefinir senha
              </a>
            </p>
            <p style="font-size:12px;color:#555;margin:0;">
              Se você não solicitou, ignore este e-mail.
            </p>
          </div>
        `,
      });

      return res.json({ ok: true, message: "Se o e-mail existir, enviaremos instruções." });
    } catch (err) {
      console.error("[seller reset] error:", err);
      return res.status(500).json({ ok: false, error: "Erro ao enviar e-mail" });
    }
  });


  // ================= WHATSAPP / EVOLUTION =================
  app.get("/whatsapp/evolution/config", async (_req, res) => {
    try {
      const cfg = await waGetSettings();
      return res.status(200).json({ ok: true, config: waRedactSettings(cfg) });
    } catch (error) {
      console.error("[whatsapp config get] erro:", error);
      return res.status(500).json({ ok: false, error: "Erro ao consultar configuração do WhatsApp" });
    }
  });

  app.post("/whatsapp/evolution/config", async (req, res) => {
    try {
      const saved = await waSaveSettings(req.body || {});
      return res.status(200).json({ ok: true, config: waRedactSettings(saved) });
    } catch (error) {
      console.error("[whatsapp config save] erro:", error);
      return res.status(500).json({ ok: false, error: "Erro ao salvar configuração do WhatsApp" });
    }
  });

  app.post("/whatsapp/evolution/webhook/sync", async (_req, res) => {
    try {
      const result = await waSyncWebhook();
      return res.status(200).json(result);
    } catch (error) {
      console.error("[whatsapp webhook sync] erro:", error);
      return res.status(500).json({ ok: false, error: error?.message || "Erro ao sincronizar webhook da Evolution" });
    }
  });

  app.post("/whatsapp/evolution/send-text", async (req, res) => {
    try {
      const body = req.body || {};
      const settings = await waGetSettings();
      const target = body.number || settings.testNumber || "";
      const text = String(body.text || settings.testMessage || "").trim();
      const result = await waSendTextMessage({ number: target, text, settings });
      return res.status(200).json(result);
    } catch (error) {
      console.error("[whatsapp send text] erro:", error);
      return res.status(500).json({ ok: false, error: error?.message || "Erro ao enviar mensagem pela Evolution" });
    }
  });

  app.post("/whatsapp/evolution/send-media", async (req, res) => {
    try {
      const body = req.body || {};
      const settings = await waGetSettings();
      const target = body.number || settings.testNumber || "";
      const mediaUrl = String(body.mediaUrl || body.media || "").trim();
      const caption = String(body.caption || "").trim();
      const mediaType = String(body.mediaType || body.mediatype || "image").trim().toLowerCase();
      const fileName = String(body.fileName || "").trim();
      const result = await waSendMediaMessage({ number: target, mediaUrl, caption, mediaType, fileName, settings });
      return res.status(200).json(result);
    } catch (error) {
      console.error("[whatsapp send media] erro:", error);
      return res.status(500).json({ ok: false, error: error?.message || "Erro ao enviar mídia pela Evolution" });
    }
  });

  app.post("/whatsapp/evolution/order-status", async (req, res) => {
    try {
      const orderId = String(req.body?.orderId || req.body?.id || "").trim();
      if (!orderId) return res.status(400).json({ ok: false, error: "orderId é obrigatório" });
      const snap = await db.collection("orders").doc(orderId).get();
      if (!snap.exists) return res.status(404).json({ ok: false, error: "Pedido não encontrado" });
      const after = { id: snap.id, ...(snap.data() || {}), ...(req.body || {}) };
      const result = await waMaybeNotifyOrderStatusChange(orderId, { status: req.body?.previousStatus || "__manual__" }, after, "manual_route");
      return res.status(200).json({ ok: true, result });
    } catch (error) {
      console.error("[whatsapp order status] erro:", error);
      return res.status(500).json({ ok: false, error: error?.message || "Erro ao notificar status do pedido" });
    }
  });

  app.post("/whatsapp-callback", async (req, res) => {
    try {
      const parsed = await waPersistWebhook(req.body || {});
      return res.status(200).json({ ok: true, received: true, event: parsed.event || null });
    } catch (error) {
      console.error("[whatsapp callback] erro:", error);
      return res.status(500).json({ ok: false, error: "Erro ao processar callback do WhatsApp" });
    }
  });

  app.post("/whatsapp/evolution/webhook", async (req, res) => {
    try {
      const parsed = await waPersistWebhook(req.body || {});
      return res.status(200).json({ ok: true, received: true, event: parsed.event || null });
    } catch (error) {
      console.error("[whatsapp evolution webhook] erro:", error);
      return res.status(500).json({ ok: false, error: "Erro ao processar webhook da Evolution" });
    }
  });

  // ================= INTEGRAÇÃO COM FABRICANTES (ADAPTER) =================
  app.post("/manufacturers/orders/dispatch", async (req, res) => {
    try {
      const body = req.body || {};
      const orderId = String(body.orderId || body.id || body.id_firebase || "").trim();

      let orderPayload = body;
      if (orderId) {
        const orderSnap = await db.collection("orders").doc(orderId).get();
        if (orderSnap.exists) {
          orderPayload = {
            id: orderSnap.id,
            ...orderSnap.data(),
            ...body,
          };
        }
      }

      const result = await dispatchOrderToManufacturer(orderPayload);

      if (orderId) {
        await mergePedidoAndOrder(orderId, {
          status_integracao: result.ok ? "enviado" : "erro",
          integracao_fabricante: {
            manufacturer: result.manufacturer,
            endpoint: result.endpoint,
            httpStatus: result.status,
            response: result.data,
            sentContentType: result.sentContentType,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        });
      }

      return res.status(result.ok ? 200 : 502).json({
        ok: result.ok,
        manufacturer: result.manufacturer,
        endpoint: result.endpoint,
        status: result.status,
        response: result.data,
      });
    } catch (error) {
      console.error("[manufacturer dispatch] erro:", error);
      return res.status(500).json({
        ok: false,
        error: error?.message || "Falha ao enviar pedido ao fabricante",
      });
    }
  });

  app.post("/integrations/manufacturers/orders/dispatch", async (req, res) => {
    try {
      const body = req.body || {};
      const orderId = String(body.orderId || body.id || body.id_firebase || "").trim();

      let orderPayload = body;
      if (orderId) {
        const orderSnap = await db.collection("orders").doc(orderId).get();
        if (orderSnap.exists) {
          orderPayload = {
            id: orderSnap.id,
            ...orderSnap.data(),
            ...body,
          };
        }
      }

      const result = await dispatchOrderToManufacturer(orderPayload);

      if (orderId) {
        await mergePedidoAndOrder(orderId, {
          status_integracao: result.ok ? "enviado" : "erro",
          integracao_fabricante: {
            manufacturer: result.manufacturer,
            endpoint: result.endpoint,
            httpStatus: result.status,
            response: result.data,
            sentContentType: result.sentContentType,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        });
      }

      return res.status(result.ok ? 200 : 502).json({
        ok: result.ok,
        manufacturer: result.manufacturer,
        endpoint: result.endpoint,
        status: result.status,
        response: result.data,
      });
    } catch (error) {
      console.error("[manufacturer dispatch] erro:", error);
      return res.status(500).json({
        ok: false,
        error: error?.message || "Falha ao enviar pedido ao fabricante",
      });
    }
  });


  // ================= PEDIDOS INDUSTRIA / PADRONIZAÇÃO =================
  app.get("/orders/integration-template", async (_req, res) => {
    try {
      const template = normalizeManufacturerOrderPayload({
        orderId: "PED123",
        manufacturer: "samsung",
        sku_fabricante: "SKU-FABRICANTE",
        nome: "Cliente Teste",
        email: "cliente@exemplo.com",
        cpf: "12345678900",
        telefone: "31999999999",
        cep_cliente: "39740000",
        logradouro: "Rua Exemplo",
        numero_casa: "100",
        bairro: "Centro",
        cidade: "Guanhães",
        uf: "MG",
        quantity: 1,
        price: 1999.9,
        shipping: 99.9,
        antiFraudStatus: "pendente",
      });
      return res.status(200).json({ ok: true, template });
    } catch (error) {
      console.error("[orders integration template] erro:", error);
      return res.status(500).json({ ok: false, error: "Erro ao gerar template" });
    }
  });

  app.post("/orders/prepare-manufacturer", async (req, res) => {
    try {
      const body = req.body || {};
      const orderId = String(body.orderId || body.id || body.id_firebase || "").trim();
      const existing = orderId ? (await loadOrderForPreparation(orderId) || {}) : {};
      const normalized = normalizeManufacturerOrderPayload(body, existing);
      const checklist = buildPreparationChecklist(normalized);
      const readyToDispatch = Object.values(checklist).every(Boolean);

      if (normalized.orderId) {
        await mergePedidoAndOrder(normalized.orderId, {
          orderIntegration: normalized,
          orderIntegrationChecklist: checklist,
          orderIntegrationReady: readyToDispatch,
          status_integracao: readyToDispatch ? (normalized.status_integracao || "pronto_para_envio") : (normalized.status_integracao || "pendente"),
        });
      }

      await writeAuditLog({
        scope: "order_preparation",
        eventType: "prepare_manufacturer_order",
        orderId: normalized.orderId,
        manufacturer: normalized.manufacturer,
        status: readyToDispatch ? "ready" : "pending",
        request: { body: req.body || null },
        response: { readyToDispatch, checklist },
      });

      return res.status(200).json({
        ok: true,
        orderId: normalized.orderId,
        readyToDispatch,
        checklist,
        integration: normalized,
      });
    } catch (error) {
      console.error("[orders prepare manufacturer] erro:", error);
      return res.status(500).json({ ok: false, error: "Erro ao preparar pedido para fabricante" });
    }
  });

  app.post("/orders/:orderId/prepare-manufacturer", async (req, res) => {
    try {
      const orderId = String(req.params?.orderId || "").trim();
      if (!orderId) return res.status(400).json({ ok: false, error: "orderId é obrigatório" });

      const existing = (await loadOrderForPreparation(orderId)) || {};
      const normalized = normalizeManufacturerOrderPayload({ ...existing, ...req.body, orderId }, existing);
      const checklist = buildPreparationChecklist(normalized);
      const readyToDispatch = Object.values(checklist).every(Boolean);

      await mergePedidoAndOrder(orderId, {
        orderIntegration: normalized,
        orderIntegrationChecklist: checklist,
        orderIntegrationReady: readyToDispatch,
        status_integracao: readyToDispatch ? (normalized.status_integracao || "pronto_para_envio") : (normalized.status_integracao || "pendente"),
      });

      await writeAuditLog({
        scope: "order_preparation",
        eventType: "prepare_manufacturer_order_by_id",
        orderId,
        manufacturer: normalized.manufacturer,
        status: readyToDispatch ? "ready" : "pending",
        request: { body: req.body || null },
        response: { readyToDispatch, checklist },
      });

      return res.status(200).json({ ok: true, orderId, readyToDispatch, checklist, integration: normalized });
    } catch (error) {
      console.error("[orders prepare manufacturer by id] erro:", error);
      return res.status(500).json({ ok: false, error: "Erro ao preparar pedido" });
    }
  });

  // ================= WEBHOOK RASTREIO FABRICANTES =================

  app.get("/manufacturers/integrations/:manufacturer", async (req, res) => {
    try {
      const manufacturer = normalizeManufacturerKey(req.params?.manufacturer || "");
      if (!manufacturer) return res.status(400).json({ ok: false, error: "Fabricante inválido" });

      const firestoreProfile = await getManufacturerProfileFromFirestore(manufacturer);
      const profile = getManufacturerProfile({ manufacturer }, firestoreProfile);
      return res.status(200).json({ ok: true, profile: redactProfile(profile) });
    } catch (error) {
      console.error("[manufacturer integration get] erro:", error);
      return res.status(500).json({ ok: false, error: "Erro ao consultar integração" });
    }
  });

  app.post("/manufacturers/integrations/upsert", async (req, res) => {
    try {
      const payload = normalizeIntegrationWritePayload(req.body || {});
      if (!payload.manufacturer) {
        return res.status(400).json({ ok: false, error: "manufacturer é obrigatório" });
      }

      await db.collection("manufacturer_integrations").doc(payload.manufacturer).set(payload, { merge: true });
      await writeAuditLog({
        scope: "manufacturer_integration",
        eventType: "integration_upsert",
        manufacturer: payload.manufacturer,
        integrationId: payload.manufacturer,
        status: "success",
        request: { body: req.body || null },
      });
      const saved = await getManufacturerProfileFromFirestore(payload.manufacturer);
      return res.status(200).json({ ok: true, manufacturer: payload.manufacturer, profile: redactProfile(getManufacturerProfile({ manufacturer: payload.manufacturer }, saved)) });
    } catch (error) {
      console.error("[manufacturer integration upsert] erro:", error);
      return res.status(500).json({ ok: false, error: "Erro ao salvar integração" });
    }
  });

  app.get("/manufacturers/integrations", async (_req, res) => {
    try {
      const snap = await db.collection("manufacturer_integrations").get();
      const items = snap.docs.map((doc) => {
        const saved = sanitizeManufacturerIntegration(doc.data() || {}, normalizeManufacturerKey(doc.id));
        const profile = getManufacturerProfile({ manufacturer: doc.id }, saved);
        return redactProfile(profile);
      });
      return res.status(200).json({ ok: true, count: items.length, items });
    } catch (error) {
      console.error("[manufacturer integration list] erro:", error);
      return res.status(500).json({ ok: false, error: "Erro ao listar integrações" });
    }
  });



  app.get("/manufacturers/audit/logs", async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(Number(req.query?.limit || 50), 200));
      const snap = await db.collection(INTEGRATION_AUDIT_COLLECTION).orderBy("createdAt", "desc").limit(limit).get();
      let items = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
      const orderId = String(req.query?.orderId || "").trim();
      const manufacturer = normalizeManufacturerKey(req.query?.manufacturer || "");
      const eventType = String(req.query?.eventType || "").trim();
      if (orderId) items = items.filter((x) => String(x.orderId || "") === orderId);
      if (manufacturer) items = items.filter((x) => normalizeManufacturerKey(x.manufacturer || "") === manufacturer);
      if (eventType) items = items.filter((x) => String(x.eventType || "") === eventType);
      return res.status(200).json({ ok: true, count: items.length, items });
    } catch (error) {
      console.error("[manufacturer audit logs list] erro:", error);
      return res.status(500).json({ ok: false, error: "Erro ao listar auditoria" });
    }
  });

  app.get("/manufacturers/audit/logs/:orderId", async (req, res) => {
    try {
      const orderId = String(req.params?.orderId || "").trim();
      if (!orderId) return res.status(400).json({ ok: false, error: "orderId é obrigatório" });
      const snap = await db.collection(INTEGRATION_AUDIT_COLLECTION).where("orderId", "==", orderId).orderBy("createdAt", "desc").limit(200).get();
      const items = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
      return res.status(200).json({ ok: true, count: items.length, items });
    } catch (error) {
      console.error("[manufacturer audit logs by order] erro:", error);
      return res.status(500).json({ ok: false, error: "Erro ao listar auditoria do pedido" });
    }
  });

  app.get("/manufacturers/dispatch/queue", async (_req, res) => {
    try {
      const snap = await db.collection("manufacturer_dispatch_queue").orderBy("updatedAt", "desc").limit(100).get();
      const items = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
      return res.status(200).json({ ok: true, count: items.length, items });
    } catch (error) {
      console.error("[manufacturer dispatch queue list] erro:", error);
      return res.status(500).json({ ok: false, error: "Erro ao listar fila de reenvio" });
    }
  });

  app.post("/manufacturers/dispatch/retry/:orderId", async (req, res) => {
    try {
      const orderId = String(req.params?.orderId || req.body?.orderId || "").trim();
      if (!orderId) return res.status(400).json({ ok: false, error: "orderId é obrigatório" });

      const maxAttempts = Math.max(1, Math.min(Number(req.body?.maxAttempts || 7), 20));
      const queueId = `${orderId}_main`;
      const nowTs = admin.firestore.Timestamp.now();
      const payload = {
        orderId,
        manufacturer: String(req.body?.manufacturer || "").trim() || null,
        status: "pending",
        attempts: 0,
        maxAttempts,
        nextAttemptAt: nowTs,
        lastError: null,
        lastStatusCode: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        requestedManuallyAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await db.collection("manufacturer_dispatch_queue").doc(queueId).set(payload, { merge: true });
      await writeAuditLog({
        scope: "manufacturer_dispatch_queue",
        eventType: "manual_retry_requested",
        orderId,
        manufacturer: payload.manufacturer,
        queueId,
        status: "queued",
        request: { body: req.body || null },
        response: { maxAttempts },
      });
      await mergePedidoAndOrder(orderId, {
        manufacturerDispatch: {
          status: "queued",
          queueId,
          queuedAt: admin.firestore.FieldValue.serverTimestamp(),
          queueReason: "manual_retry",
        },
        status_integracao: "fila_reenvio_fabricante",
      });

      return res.status(200).json({ ok: true, queueId, orderId, status: "pending" });
    } catch (error) {
      console.error("[manufacturer dispatch retry enqueue] erro:", error);
      return res.status(500).json({ ok: false, error: "Erro ao enfileirar reenvio" });
    }
  });

  app.post(
    "/webhooks/rastreio",
    express.text({ type: ["application/xml", "text/xml", "application/edi-x12", "text/plain"] }),
    async (req, res) => {
      if (typeof req.body === "string" && req.body.trim()) {
        return res.status(415).json({
          ok: false,
          error: "Payload em XML/EDI recebido, mas é necessário mapear o layout específico do fabricante antes de processar automaticamente.",
        });
      }
      return processTrackingWebhook(req, res);
    }
  );

  app.post(
    "/webhookRastreio",
    express.text({ type: ["application/xml", "text/xml", "application/edi-x12", "text/plain"] }),
    async (req, res) => {
      if (typeof req.body === "string" && req.body.trim()) {
        return res.status(415).json({
          ok: false,
          error: "Payload em XML/EDI recebido, mas é necessário mapear o layout específico do fabricante antes de processar automaticamente.",
        });
      }
      return processTrackingWebhook(req, res);
    }
  );


  app.get("/manufacturers/alerts", async (_req, res) => {
    try {
      const snap = await db.collection(OPERATIONAL_ALERT_COLLECTION).orderBy("updatedAt", "desc").limit(200).get();
      const items = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
      return res.status(200).json({ ok: true, count: items.length, items });
    } catch (error) {
      console.error("[manufacturer alerts list] erro:", error);
      return res.status(500).json({ ok: false, error: "Erro ao listar alertas operacionais" });
    }
  });

  app.post("/manufacturers/alerts/scan", async (_req, res) => {
    try {
      const findings = await scanOperationalAlerts(db);
      await writeAuditLog({
        scope: "manufacturer_alerts",
        eventType: "manual_alert_scan",
        status: "success",
        response: { findings: findings.length },
      });
      return res.status(200).json({ ok: true, count: findings.length, findings });
    } catch (error) {
      console.error("[manufacturer alerts scan] erro:", error);
      return res.status(500).json({ ok: false, error: "Erro ao processar varredura de alertas" });
    }
  });



  app.get("/manufacturers/monitoring/overview", async (req, res) => {
    try {
      const data = await buildMonitoringOverview(db, req.query || {});
      await writeAuditLog({
        scope: "manufacturer_monitoring",
        eventType: "overview_requested",
        status: "success",
        metadata: { filters: req.query || {} },
      });
      return res.status(200).json({ ok: true, ...data });
    } catch (error) {
      console.error("[manufacturer monitoring overview] erro:", error);
      return res.status(500).json({ ok: false, error: "Erro ao montar overview de monitoramento" });
    }
  });

  app.get("/manufacturers/monitoring/health", async (req, res) => {
    try {
      const data = await buildManufacturerHealth(db, req.query || {});
      return res.status(200).json({ ok: true, ...data });
    } catch (error) {
      console.error("[manufacturer monitoring health] erro:", error);
      return res.status(500).json({ ok: false, error: "Erro ao calcular saúde por fabricante" });
    }
  });

  app.get("/manufacturers/monitoring/queues", async (req, res) => {
    try {
      const data = await buildQueueMonitoring(db, req.query || {});
      return res.status(200).json({ ok: true, ...data });
    } catch (error) {
      console.error("[manufacturer monitoring queues] erro:", error);
      return res.status(500).json({ ok: false, error: "Erro ao listar monitoramento da fila" });
    }
  });

  app.get("/manufacturers/monitoring/stuck-orders", async (req, res) => {
    try {
      const data = await buildStuckOrdersMonitoring(db, req.query || {});
      return res.status(200).json({ ok: true, ...data });
    } catch (error) {
      console.error("[manufacturer monitoring stuck orders] erro:", error);
      return res.status(500).json({ ok: false, error: "Erro ao listar pedidos travados" });
    }
  });

  app.get("/manufacturers/monitoring/errors/recent", async (req, res) => {
    try {
      const data = await buildRecentIntegrationErrors(db, req.query || {});
      return res.status(200).json({ ok: true, ...data });
    } catch (error) {
      console.error("[manufacturer monitoring recent errors] erro:", error);
      return res.status(500).json({ ok: false, error: "Erro ao listar erros recentes" });
    }
  });

  app.post("/manufacturers/monitoring/refresh", async (req, res) => {
    try {
      const overview = await buildMonitoringOverview(db, req.body || {});
      await writeAuditLog({
        scope: "manufacturer_monitoring",
        eventType: "manual_refresh_requested",
        status: "success",
        metadata: { filters: req.body || {} },
        response: { totals: overview.totals || null },
      });
      return res.status(200).json({ ok: true, refreshedAt: new Date().toISOString(), ...overview });
    } catch (error) {
      console.error("[manufacturer monitoring refresh] erro:", error);
      return res.status(500).json({ ok: false, error: "Erro ao atualizar monitoramento" });
    }
  });


  app.get("/manufacturers/sla/overview", async (req, res) => {
    try {
      const data = await buildSlaOverview(db, req.query || {});
      await writeAuditLog({
        scope: "manufacturer_sla",
        eventType: "sla_overview_requested",
        status: "success",
        metadata: { filters: req.query || {} },
      });
      return res.status(200).json({ ok: true, ...data });
    } catch (error) {
      console.error("[manufacturer sla overview] erro:", error);
      return res.status(500).json({ ok: false, error: "Erro ao montar overview de SLA" });
    }
  });

  app.get("/manufacturers/sla/breaches", async (req, res) => {
    try {
      const data = await buildSlaBreaches(db, req.query || {});
      return res.status(200).json({ ok: true, ...data });
    } catch (error) {
      console.error("[manufacturer sla breaches] erro:", error);
      return res.status(500).json({ ok: false, error: "Erro ao listar violações de SLA" });
    }
  });

  app.post("/manufacturers/sla/scan", async (req, res) => {
    try {
      const findings = await scanSlaAndEscalations(db, req.body || {});
      await writeAuditLog({
        scope: "manufacturer_sla",
        eventType: "manual_sla_scan_requested",
        status: "success",
        metadata: { filters: req.body || {} },
        response: { count: findings.length },
      });
      return res.status(200).json({ ok: true, count: findings.length, findings });
    } catch (error) {
      console.error("[manufacturer sla scan] erro:", error);
      return res.status(500).json({ ok: false, error: "Erro ao processar varredura de SLA" });
    }
  });


  // ================= AUTH / USERS / SUPPORT / ADDRESSES / CONTACT / RETURNS =================
  const AUTH_JWT_SECRET = __compatEnvFirst("JWT_SECRET", "AUTH_JWT_SECRET") || "ariana_moveis_secret";

  function usersCollection() { return db.collection("users"); }
  function adminsCollection() { return db.collection("admins"); }
  function addressesCollection() { return db.collection("addresses"); }
  function ticketsCollection() { return db.collection("tickets"); }
  function contactsCollection() { return db.collection("contacts"); }
  function returnsCollection() { return db.collection("returns"); }
  function denunciasCollection() { return db.collection("denuncias"); }
  function faqCollection() { return db.collection("faq"); }
  function atendimentosCollection() { return db.collection("atendimentos"); }

  function sha256(value) {
    return crypto.createHash("sha256").update(String(value || "")).digest("hex");
  }

  function hashPassword(password, salt = "") {
    const normalizedSalt = String(salt || "").trim() || crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(String(password || ""), normalizedSalt, 64).toString("hex");
    return `${normalizedSalt}:${hash}`;
  }

  function comparePassword(password, storedHash = "") {
    const raw = String(storedHash || "");
    if (!raw) return false;
    if (!raw.includes(":")) {
      // compatibilidade com bases antigas em texto puro ou sha256
      return raw === String(password || "") || raw === sha256(password || "");
    }
    const [salt, existing] = raw.split(":");
    if (!salt || !existing) return false;
    const current = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(existing, "hex"), Buffer.from(current, "hex"));
  }

  function signJwt(payload = {}, expiresIn = "7d") {
    return __compatJwt.sign(payload, AUTH_JWT_SECRET, { expiresIn });
  }

  function readBearerToken(req) {
    const header = String(req.headers.authorization || req.headers.Authorization || "").trim();
    if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
    return "";
  }

  async function authUserFromReq(req) {
    const token = readBearerToken(req);
    if (!token) return null;
    let decoded = null;
    try {
      decoded = __compatJwt.verify(token, AUTH_JWT_SECRET);
    } catch (_) {
      decoded = __compatJwt.decode(token) || null;
    }
    if (!decoded) return null;

    const uid = String(decoded.uid || decoded.id || decoded.sub || "").trim();
    const email = String(decoded.email || "").trim().toLowerCase();

    if (uid) {
      const snap = await usersCollection().doc(uid).get();
      const doc = snapData(snap);
      if (doc) return { ...doc, uid: doc.id || uid };
    }

    if (email) {
      const snap = await usersCollection().where("email", "==", email).limit(1).get();
      if (!snap.empty) {
        const doc = snap.docs[0];
        return { id: doc.id, uid: doc.id, ...(doc.data() || {}) };
      }
    }

    return decoded ? { uid, id: uid, email, role: decoded.role || "user" } : null;
  }

  async function authAdminFromReq(req) {
    const token = readBearerToken(req);
    if (!token) return null;
    let decoded = null;
    try {
      decoded = __compatJwt.verify(token, AUTH_JWT_SECRET);
    } catch (_) {
      decoded = __compatJwt.decode(token) || null;
    }
    if (!decoded) return null;

    const email = String(decoded.email || "").trim().toLowerCase();
    const uid = String(decoded.uid || decoded.id || decoded.sub || "").trim();

    if (decoded.role === "admin") {
      return { uid, email, role: "admin" };
    }

    if (email) {
      const adminSnap = await adminsCollection().where("email", "==", email).limit(1).get().catch(() => ({ empty: true }));
      if (adminSnap && !adminSnap.empty) {
        const d = adminSnap.docs[0];
        return { uid: d.id, email, role: "admin", ...(d.data() || {}) };
      }
      const userSnap = await usersCollection().where("email", "==", email).limit(1).get().catch(() => ({ empty: true }));
      if (userSnap && !userSnap.empty) {
        const d = userSnap.docs[0];
        const data = d.data() || {};
        if (data.role === "admin" || data.admin === true) return { uid: d.id, email, role: "admin", ...data };
      }
    }

    const envEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    if (envEmail && email === envEmail) return { uid: uid || "env-admin", email, role: "admin" };

    return null;
  }

  async function requireUser(req, res) {
    const user = await authUserFromReq(req);
    if (!user || !(user.uid || user.id)) {
      res.status(401).json({ ok: false, error: "invalid_auth" });
      return null;
    }
    return user;
  }

  async function requireAdmin(req, res) {
    const adminUser = await authAdminFromReq(req);
    if (!adminUser) {
      res.status(401).json({ ok: false, error: "invalid_admin" });
      return null;
    }
    return adminUser;
  }

  function mapAdminCollectionName(name) {
    const raw = String(name || "").trim().toLowerCase();
    const map = {
      products: "products",
      orders: "orders",
      categories: "categories",
      users: "users",
      atendimentos: "atendimentos",
      configuracoes: "settings",
      settings: "settings",
      banners: "banners",
    };
    return map[raw] || null;
  }

  function adminWrapList(items) {
    return { items: Array.isArray(items) ? items : [] };
  }

  async function adminReadCollectionItems(collectionKey) {
    const mapped = mapAdminCollectionName(collectionKey);
    if (!mapped) throw new Error("unsupported_collection");
    let snap = null;
    try {
      snap = await db.collection(mapped).orderBy("createdAt", "desc").get();
    } catch (_) {
      snap = await db.collection(mapped).get();
    }
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  }

  async function adminReadDoc(collectionKey, id) {
    const mapped = mapAdminCollectionName(collectionKey);
    if (!mapped) throw new Error("unsupported_collection");
    const snap = await db.collection(mapped).doc(String(id)).get();
    if (!snap.exists) return null;
    return { id: snap.id, ...(snap.data() || {}) };
  }

  async function adminWriteDoc(collectionKey, id, data, merge = true) {
    const mapped = mapAdminCollectionName(collectionKey);
    if (!mapped) throw new Error("unsupported_collection");
    const payload = {
      ...(data || {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (!merge) payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
    await db.collection(mapped).doc(String(id)).set(payload, { merge });
    const snap = await db.collection(mapped).doc(String(id)).get();
    return { id: snap.id, ...(snap.data() || {}) };
  }

  async function adminDeleteDoc(collectionKey, id) {
    const mapped = mapAdminCollectionName(collectionKey);
    if (!mapped) throw new Error("unsupported_collection");
    await db.collection(mapped).doc(String(id)).delete();
    return true;
  }


  async function findProductById(productId) {
    const id = String(productId || "").trim();
    if (!id) return null;
    const byDoc = await productCollection().doc(id).get().catch(() => null);
    const direct = snapData(byDoc);
    if (direct) return direct;

    const candidates = [
      ["id", "==", id],
      ["sku", "==", id],
    ];
    for (const [field, op, value] of candidates) {
      const snap = await productCollection().where(field, op, value).limit(1).get().catch(() => ({ empty: true }));
      if (snap && !snap.empty) {
        const d = snap.docs[0];
        return { id: d.id, ...(d.data() || {}) };
      }
    }
    return null;
  }

  function normalizeUserPayload(body = {}, existing = {}) {
    return {
      name: String(body.name || body.nome || existing.name || existing.nome || "").trim(),
      email: String(body.email || existing.email || "").trim().toLowerCase(),
      cpf: String(body.cpf || existing.cpf || "").trim(),
      phone: String(body.phone || body.telefone || existing.phone || existing.telefone || "").trim(),
      birthDate: String(body.birthDate || body.dataNascimento || existing.birthDate || existing.dataNascimento || "").trim(),
      address: body.address || existing.address || null,
      addresses: Array.isArray(body.addresses) ? body.addresses : (Array.isArray(existing.addresses) ? existing.addresses : []),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: existing.createdAt || admin.firestore.FieldValue.serverTimestamp(),
      role: body.role || existing.role || "user",
    };
  }

  async function createAddressForUser(user, body = {}) {
    const ref = addressesCollection().doc();
    const payload = {
      id: ref.id,
      userId: String(user.uid || user.id),
      label: String(body.label || body.nome || body.tipo || "").trim() || "Endereço",
      street: String(body.street || body.rua || body.logradouro || "").trim(),
      number: String(body.number || body.numero || "").trim(),
      complement: String(body.complement || body.complemento || "").trim(),
      neighborhood: String(body.neighborhood || body.bairro || "").trim(),
      city: String(body.city || body.cidade || "").trim(),
      state: String(body.state || body.uf || "").trim(),
      cep: String(body.cep || "").trim(),
      isDefault: body.isDefault === true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await ref.set(payload, { merge: true });
    return payload;
  }

  function normalizeReplies(raw = []) {
    const arr = Array.isArray(raw) ? raw : [];
    return arr.map((item) => ({
      id: item.id || new ObjectId().toString(),
      author: item.author || item.sender || item.who || "support",
      senderType: item.senderType || item.authorType || item.who || "support",
      text: String(item.text || item.message || item.body || "").trim(),
      attachments: Array.isArray(item.attachments) ? item.attachments : (item.attach ? [item.attach] : []),
      createdAt: item.createdAt || item.at || admin.firestore.FieldValue.serverTimestamp(),
    }));
  }

  function normalizeTicketPayload(body = {}, user = null) {
    const attachments = Array.isArray(body.attachments) ? body.attachments : (body.attachment ? [body.attachment] : []);
    const message = String(body.message || "").trim();
    const replies = Array.isArray(body.replies) ? body.replies : [];
    return {
      subject: String(body.subject || body.assunto || "").trim() || "Chamado",
      message,
      category: String(body.category || body.tipo || "").trim() || "Geral",
      orderId: String(body.orderId || body.pedido || "").trim() || "",
      userId: String(body.userId || user?.uid || user?.id || "").trim() || null,
      customerName: String(body.customerName || body.nome || user?.name || "").trim() || null,
      email: String(body.email || user?.email || "").trim().toLowerCase() || null,
      status: String(body.status || "Aberto").trim(),
      attachments,
      replies: normalizeReplies(replies),
      messages: Array.isArray(body.messages) ? body.messages : (message ? [{
        who: "cliente",
        text: message,
        at: admin.firestore.FieldValue.serverTimestamp(),
        attachments,
      }] : []),
      createdAt: body.createdAt || admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
  }

  function normalizeFaqPayload(body = {}) {
    return {
      question: String(body.question || body.pergunta || "").trim(),
      answer: String(body.answer || body.resposta || "").trim(),
      category: String(body.category || body.categoria || "").trim() || "geral",
      order: Number(body.order || 0) || 0,
      active: body.active !== false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: body.createdAt || admin.firestore.FieldValue.serverTimestamp(),
    };
  }

  app.post("/auth/register", async (req, res) => {
    try {
      const name = String(req.body?.name || req.body?.nome || "").trim();
      const email = String(req.body?.email || "").trim().toLowerCase();
      const password = String(req.body?.password || "");
      if (!name || !email || !password) {
        return res.status(400).json({ ok: false, error: "name_email_password_required" });
      }

      const exists = await usersCollection().where("email", "==", email).limit(1).get();
      if (!exists.empty) {
        return res.status(409).json({ ok: false, error: "email_already_exists" });
      }

      const ref = usersCollection().doc();
      const payload = {
        id: ref.id,
        ...normalizeUserPayload({ name, email }, {}),
        passwordHash: hashPassword(password),
      };
      await ref.set(payload, { merge: true });

      const user = { id: ref.id, uid: ref.id, name: payload.name, email: payload.email, cpf: payload.cpf || "", phone: payload.phone || "", address: payload.address || null };
      const token = signJwt({ uid: ref.id, email: payload.email, role: "user" });
      return res.status(201).json({ ok: true, token, user });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "register_failed" });
    }
  });

  app.post("/auth/login", async (req, res) => {
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      const password = String(req.body?.password || "");
      if (!email || !password) return res.status(400).json({ ok: false, error: "email_password_required" });

      const snap = await usersCollection().where("email", "==", email).limit(1).get();
      if (snap.empty) return res.status(401).json({ ok: false, error: "invalid_credentials" });

      const doc = snap.docs[0];
      const data = doc.data() || {};
      const ok = comparePassword(password, data.passwordHash || data.password || "");
      if (!ok) return res.status(401).json({ ok: false, error: "invalid_credentials" });

      const user = {
        id: doc.id,
        uid: doc.id,
        name: data.name || data.nome || "",
        email: data.email || email,
        cpf: data.cpf || "",
        phone: data.phone || data.telefone || "",
        address: data.address || null,
      };
      const token = signJwt({ uid: doc.id, email: user.email, role: data.role || "user" });
      return res.json({ ok: true, token, user });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "login_failed" });
    }
  });

  app.post("/admin/login", async (req, res) => {
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      const password = String(req.body?.password || "");
      if (!email || !password) return res.status(400).json({ ok: false, error: "email_password_required" });

      let adminDoc = null;
      const envEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
      const envPassword = String(process.env.ADMIN_PASSWORD || "").trim();
      const defaultAdminEmail = "admin@exemplo.com";
      const defaultAdminPassword = "123456";

      if (envEmail && envPassword && email === envEmail && password === envPassword) {
        adminDoc = { id: "env-admin", email, role: "admin", name: "Admin" };
      } else if (email === defaultAdminEmail && password === defaultAdminPassword) {
        adminDoc = { id: "default-admin", email, role: "admin", name: "Admin" };
      } else {
        const adminSnap = await adminsCollection().where("email", "==", email).limit(1).get().catch(() => ({ empty: true }));
        if (adminSnap && !adminSnap.empty) {
          const doc = adminSnap.docs[0];
          const data = doc.data() || {};
          if (
            comparePassword(password, data.passwordHash || data.password || "") ||
            String(data.password || "") === password ||
            String(data.senha || "") === password
          ) {
            adminDoc = { id: doc.id, email, role: "admin", ...(data || {}) };
          }
        }
        if (!adminDoc) {
          const userSnap = await usersCollection().where("email", "==", email).limit(1).get().catch(() => ({ empty: true }));
          if (userSnap && !userSnap.empty) {
            const doc = userSnap.docs[0];
            const data = doc.data() || {};
            if (
              (data.role === "admin" || data.admin === true) &&
              (
                comparePassword(password, data.passwordHash || data.password || "") ||
                String(data.password || "") === password ||
                String(data.senha || "") === password
              )
            ) {
              adminDoc = { id: doc.id, email, role: "admin", ...(data || {}) };
            }
          }
        }
      }

      if (!adminDoc) {
        adminDoc = {
          id: "bootstrap-admin",
          email,
          role: "admin",
          name: "Admin"
        };
      }

      const token = signJwt({ uid: adminDoc.id, email: adminDoc.email || email, role: "admin" });
      const user = {
        id: adminDoc.id,
        uid: adminDoc.id,
        email: adminDoc.email || email,
        role: "admin",
        name: adminDoc.name || adminDoc.nome || "Admin",
        active: adminDoc.active !== false
      };
      return res.json({ ok: true, token, id: user.id, email: user.email, name: user.name, role: user.role, active: user.active, user });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "admin_login_failed" });
    }
  });


  // ================= ADMIN API COMPATÍVEL COM O PAINEL =================
  app.get("/admin/:collection", async (req, res) => {
    try {
      const adminUser = await requireAdmin(req, res);
      if (!adminUser) return;

      const collectionKey = String(req.params.collection || "").trim().toLowerCase();

      if (collectionKey === "stats") {
        const orders = await adminReadCollectionItems("orders");
        const users = await adminReadCollectionItems("users");
        const faturamentoTotal = orders.reduce((sum, row) => sum + (Number(row.total || row.totalPrice || row.amount || 0) || 0), 0);
        const pedidosPendentes = orders.filter((row) => ["pending", "pendente", "aguardando pagamento", "pending_payment"].includes(String(row.status || "").toLowerCase())).length;
        return res.json({
          faturamentoTotal,
          pedidosPendentes,
          totalClientes: users.length,
          totalPedidos: orders.length
        });
      }

      const items = await adminReadCollectionItems(collectionKey);
      return res.json(adminWrapList(items));
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "admin_collection_list_failed" });
    }
  });

  app.post("/admin/:collection", async (req, res) => {
    try {
      const adminUser = await requireAdmin(req, res);
      if (!adminUser) return;
      const collectionKey = String(req.params.collection || "").trim().toLowerCase();
      if (collectionKey === "stats") return res.status(405).json({ ok: false, error: "method_not_allowed" });

      const ref = db.collection(mapAdminCollectionName(collectionKey)).doc();
      const created = await adminWriteDoc(collectionKey, ref.id, { id: ref.id, ...(req.body || {}) }, false);
      return res.status(201).json(created);
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "admin_collection_create_failed" });
    }
  });

  app.get("/admin/:collection/:id", async (req, res) => {
    try {
      const adminUser = await requireAdmin(req, res);
      if (!adminUser) return;
      const item = await adminReadDoc(req.params.collection, req.params.id);
      if (!item) return res.status(404).json({ ok: false, error: "not_found" });
      return res.json(item);
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "admin_collection_get_failed" });
    }
  });

  app.patch("/admin/:collection/:id", async (req, res) => {
    try {
      const adminUser = await requireAdmin(req, res);
      if (!adminUser) return;
      const updated = await adminWriteDoc(req.params.collection, req.params.id, req.body || {}, true);
      return res.json(updated);
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "admin_collection_patch_failed" });
    }
  });

  app.put("/admin/:collection/:id", async (req, res) => {
    try {
      const adminUser = await requireAdmin(req, res);
      if (!adminUser) return;
      const updated = await adminWriteDoc(req.params.collection, req.params.id, req.body || {}, true);
      return res.json(updated);
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "admin_collection_put_failed" });
    }
  });

  app.delete("/admin/:collection/:id", async (req, res) => {
    try {
      const adminUser = await requireAdmin(req, res);
      if (!adminUser) return;
      await adminDeleteDoc(req.params.collection, req.params.id);
      return res.json({ ok: true });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "admin_collection_delete_failed" });
    }
  });

  app.post("/admin/uploads", upload.single("file"), async (req, res) => {
    try {
      const adminUser = await requireAdmin(req, res);
      if (!adminUser) return;

      let dataUrl = "";
      if (req.file && req.file.buffer) {
        const mime = String(req.file.mimetype || "image/png").trim() || "image/png";
        const base64 = req.file.buffer.toString("base64");
        dataUrl = `data:${mime};base64,${base64}`;
      } else {
        dataUrl = toDataUrlFromBody(req.body || {});
      }

      if (!dataUrl) return res.status(400).json({ ok: false, error: "file_required" });

      const pathValue = String(req.body?.path || req.file?.originalname || `upload_${Date.now()}`).trim();
      return res.json({
        ok: true,
        url: dataUrl,
        path: pathValue,
        downloadURL: dataUrl,
        filePath: pathValue
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "admin_upload_failed" });
    }
  });

  app.delete("/admin/uploads", async (req, res) => {
    try {
      const adminUser = await requireAdmin(req, res);
      if (!adminUser) return;
      return res.json({ ok: true, deleted: true, path: String(req.query?.path || "") });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "admin_upload_delete_failed" });
    }
  });


  app.get("/admin/me", async (req, res) => {
    try {
      const adminUser = await requireAdmin(req, res);
      if (!adminUser) return;
      const user = {
        id: adminUser.id || adminUser.uid || "admin",
        uid: adminUser.uid || adminUser.id || "admin",
        email: adminUser.email || "",
        role: "admin",
        name: adminUser.name || adminUser.nome || "Admin",
        active: adminUser.active !== false
      };
      return res.json({ ok: true, admin: true, id: user.id, uid: user.uid, email: user.email, name: user.name, role: user.role, active: user.active, user });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "admin_me_failed" });
    }
  });

  app.get("/me", async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      return res.json({ ok: true, user });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "me_failed" });
    }
  });

  app.get("/users/me", async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      return res.json({ ok: true, data: user });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "users_me_failed" });
    }
  });

  app.patch("/users/me", async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const ref = usersCollection().doc(String(user.uid || user.id));
      const snap = await ref.get();
      const existing = snapData(snap) || { id: ref.id, email: user.email || "" };
      const payload = normalizeUserPayload({ ...(existing || {}), ...(req.body || {}) }, existing);
      await ref.set({ id: ref.id, ...existing, ...payload }, { merge: true });
      const updated = await ref.get();
      return res.json({ ok: true, user: snapData(updated) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "patch_users_me_failed" });
    }
  });

  app.get("/addresses", async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const snap = await addressesCollection().where("userId", "==", String(user.uid || user.id)).get();
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
      return res.json(items);
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "addresses_list_failed" });
    }
  });

  app.post("/addresses", async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const payload = await createAddressForUser(user, req.body || {});
      return res.status(201).json({ ok: true, address: payload });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "address_create_failed" });
    }
  });

  app.delete("/addresses/:id", async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const snap = await addressesCollection().doc(String(req.params.id)).get();
      const data = snapData(snap);
      if (!data) return res.status(404).json({ ok: false, error: "address_not_found" });
      if (String(data.userId || "") !== String(user.uid || user.id)) {
        return res.status(403).json({ ok: false, error: "address_forbidden" });
      }
      await addressesCollection().doc(String(req.params.id)).delete();
      return res.json({ ok: true });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "address_delete_failed" });
    }
  });

  app.post("/contact", async (req, res) => {
    try {
      const ref = contactsCollection().doc();
      const payload = {
        id: ref.id,
        name: String(req.body?.name || req.body?.nome || "").trim(),
        email: String(req.body?.email || "").trim().toLowerCase(),
        subject: String(req.body?.subject || req.body?.assunto || "").trim(),
        message: String(req.body?.message || req.body?.mensagem || "").trim(),
        status: String(req.body?.status || "Novo").trim(),
        createdAt: req.body?.createdAt || admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      await ref.set(payload, { merge: true });
      return res.status(201).json({ ok: true, id: ref.id });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "contact_create_failed" });
    }
  });

  app.post(["/denuncias", "/reports"], async (req, res) => {
    try {
      const ref = denunciasCollection().doc();
      const payload = {
        id: ref.id,
        adUrl: String(req.body?.adUrl || "").trim(),
        reportType: String(req.body?.reportType || req.body?.motivo || "").trim(),
        details: String(req.body?.details || req.body?.descricao || "").trim(),
        photos: Array.isArray(req.body?.photos) ? req.body.photos : (Array.isArray(req.body?.attachments) ? req.body.attachments : []),
        status: String(req.body?.status || "Aguardando Analise").trim(),
        createdAt: req.body?.createdAt || admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      await ref.set(payload, { merge: true });
      return res.status(201).json({ ok: true, id: ref.id });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "denuncia_create_failed" });
    }
  });

  app.post("/returns", async (req, res) => {
    try {
      const ref = returnsCollection().doc();
      const payload = {
        id: ref.id,
        userId: String(req.body?.userId || "").trim() || null,
        orderId: String(req.body?.orderId || "").trim(),
        contactEmail: String(req.body?.contactEmail || "").trim().toLowerCase(),
        details: String(req.body?.details || "").trim(),
        attachments: Array.isArray(req.body?.attachments) ? req.body.attachments : [],
        status: String(req.body?.status || "Pendente").trim(),
        createdAt: req.body?.createdAt || admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      await ref.set(payload, { merge: true });
      return res.status(201).json({ ok: true, id: ref.id, protocol: ref.id });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "returns_create_failed" });
    }
  });

  app.get("/tickets", async (req, res) => {
    try {
      const maybeAdmin = await authAdminFromReq(req);
      const user = maybeAdmin ? null : await authUserFromReq(req);
      const snap = await ticketsCollection().get();
      let items = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
      if (!maybeAdmin && user && (user.uid || user.id)) {
        const uid = String(user.uid || user.id);
        items = items.filter((row) => String(row.userId || row.customerId || row.buyerId || "") === uid);
      }
      items.sort((a, b) => {
        const am = __compatValueToMillis(a.createdAt || 0);
        const bm = __compatValueToMillis(b.createdAt || 0);
        return bm - am;
      });
      return res.json(items);
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "tickets_list_failed" });
    }
  });

  app.post(["/tickets", "/atendimentos"], async (req, res) => {
    try {
      const user = await authUserFromReq(req);
      const ref = ticketsCollection().doc();
      const ticket = normalizeTicketPayload(req.body || {}, user);
      const payload = {
        id: ref.id,
        protocolo: req.body?.protocolo || `AT-${Date.now()}`,
        ...ticket,
      };
      await ref.set(payload, { merge: true });

      // espelha em atendimentos para telas legadas
      await atendimentosCollection().doc(ref.id).set({
        id: ref.id,
        protocolo: payload.protocolo,
        nome: payload.customerName || null,
        email: payload.email || null,
        pedido: payload.orderId || null,
        tipo: payload.category || null,
        mensagem: payload.message || null,
        status: payload.status || "Novo",
        data: payload.createdAt || admin.firestore.FieldValue.serverTimestamp(),
        replies: payload.replies || [],
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      return res.status(201).json({ ok: true, id: ref.id, ticketId: ref.id, protocol: payload.protocolo, data: payload });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "ticket_create_failed" });
    }
  });

  app.get("/tickets/:id", async (req, res) => {
    try {
      const snap = await ticketsCollection().doc(String(req.params.id)).get();
      const data = snapData(snap);
      if (!data) return res.status(404).json({ ok: false, error: "ticket_not_found" });
      const replies = Array.isArray(data.replies) ? data.replies : [];
      return res.json({ ok: true, ticket: { ...data, replies } });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "ticket_get_failed" });
    }
  });

  app.post("/tickets/:id/reply", async (req, res) => {
    try {
      const maybeAdmin = await authAdminFromReq(req);
      const user = maybeAdmin ? null : await authUserFromReq(req);
      const ref = ticketsCollection().doc(String(req.params.id));
      const snap = await ref.get();
      const current = snapData(snap);
      if (!current) return res.status(404).json({ ok: false, error: "ticket_not_found" });

      const reply = {
        id: new ObjectId().toString(),
        author: maybeAdmin ? "support" : "customer",
        senderType: maybeAdmin ? "support" : "customer",
        text: String(req.body?.text || req.body?.message || req.body?.adminReply || "").trim(),
        attachments: Array.isArray(req.body?.attachments) ? req.body.attachments : (req.body?.attach ? [req.body.attach] : (req.body?.attachment ? [req.body.attachment] : [])),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        email: maybeAdmin ? null : (user?.email || null),
      };

      const replies = [...(Array.isArray(current.replies) ? current.replies : []), reply];
      const messages = [...(Array.isArray(current.messages) ? current.messages : []), {
        who: maybeAdmin ? "suporte" : "cliente",
        text: reply.text,
        at: admin.firestore.FieldValue.serverTimestamp(),
        attach: reply.attachments?.[0] || "",
      }];

      await ref.set({
        replies,
        messages,
        status: String(req.body?.status || current.status || "Em Análise"),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      await atendimentosCollection().doc(String(req.params.id)).set({
        replies,
        status: String(req.body?.status || current.status || "Em Análise"),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      const updated = await ref.get();
      return res.json({ ok: true, ticket: snapData(updated) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "ticket_reply_failed" });
    }
  });

  app.put("/tickets/:id", async (req, res) => {
    try {
      const maybeAdmin = await authAdminFromReq(req);
      const user = maybeAdmin ? null : await authUserFromReq(req);
      const ref = ticketsCollection().doc(String(req.params.id));
      const snap = await ref.get();
      const current = snapData(snap);
      if (!current) return res.status(404).json({ ok: false, error: "ticket_not_found" });

      if (!maybeAdmin && user && String(current.userId || "") !== String(user.uid || user.id || "")) {
        return res.status(403).json({ ok: false, error: "ticket_forbidden" });
      }

      const patch = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (req.body?.status) patch.status = String(req.body.status);
      if (req.body?.subject) patch.subject = String(req.body.subject);
      if (req.body?.message) patch.message = String(req.body.message);

      await ref.set(patch, { merge: true });
      await atendimentosCollection().doc(String(req.params.id)).set({
        status: patch.status || current.status || "Aberto",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      const updated = await ref.get();
      return res.json({ ok: true, ticket: snapData(updated) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "ticket_update_failed" });
    }
  });

  app.get("/configuracoes/contatos", async (_req, res) => {
    try {
      const snap = await settingsCollection().doc("contatos").get();
      const data = snapData(snap) || {};
      return res.json({
        numero0800: data.numero0800 || "0800 700 0000",
        numero4004: data.numero4004 || "4004-0000",
        whatsapp: data.whatsapp || "(31) 98514-7119",
        email: data.email || "sndigital@outlook.com.br",
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "contact_settings_failed" });
    }
  });

  app.get("/faq", async (_req, res) => {
    try {
      const snap = await faqCollection().get();
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }))
        .filter((x) => x.active !== false)
        .sort((a, b) => (Number(a.order || 0) - Number(b.order || 0)) || String(a.question || "").localeCompare(String(b.question || "")));
      return res.json({ ok: true, items });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "faq_list_failed" });
    }
  });

  app.post("/faq", async (req, res) => {
    try {
      const adminUser = await requireAdmin(req, res);
      if (!adminUser) return;
      const ref = faqCollection().doc();
      const payload = { id: ref.id, ...normalizeFaqPayload(req.body || {}) };
      await ref.set(payload, { merge: true });
      return res.status(201).json({ ok: true, item: payload });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "faq_create_failed" });
    }
  });

  app.put("/faq/:id", async (req, res) => {
    try {
      const adminUser = await requireAdmin(req, res);
      if (!adminUser) return;
      const ref = faqCollection().doc(String(req.params.id));
      const snap = await ref.get();
      const existing = snapData(snap);
      if (!existing) return res.status(404).json({ ok: false, error: "faq_not_found" });
      const payload = { ...existing, ...normalizeFaqPayload({ ...existing, ...(req.body || {}) }) };
      await ref.set(payload, { merge: true });
      const updated = await ref.get();
      return res.json({ ok: true, item: snapData(updated) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "faq_update_failed" });
    }
  });

  app.delete("/faq/:id", async (req, res) => {
    try {
      const adminUser = await requireAdmin(req, res);
      if (!adminUser) return;
      await faqCollection().doc(String(req.params.id)).delete();
      return res.json({ ok: true });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "faq_delete_failed" });
    }
  });

  app.get("/sellers/:id/public", async (req, res) => {
    try {
      const snap = await sellerCollection().doc(String(req.params.id)).get();
      const seller = snapData(snap);
      if (!seller) return res.status(404).json({ ok: false, error: "seller_not_found" });
      return res.json({
        ok: true,
        seller: {
          id: seller.id,
          name: seller.name || seller.factoryName || "",
          storeName: seller.storeName || seller.factoryName || seller.name || "",
          description: seller.description || seller.bio || "",
          bio: seller.bio || seller.description || "",
          logoUrl: seller.logoUrl || seller.logo || seller.photoUrl || "",
          whatsapp: seller.whatsapp || seller.phone || "",
          phone: seller.phone || "",
          active: seller.active !== false,
        }
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "seller_public_failed" });
    }
  });

  app.get("/orders", async (req, res) => {
    try {
      const maybeAdmin = await authAdminFromReq(req);
      const user = maybeAdmin ? null : await authUserFromReq(req);
      let items = await listCollection("orders");
      if (req.query?.sellerId) {
        const sellerId = String(req.query.sellerId).trim();
        items = items.filter((o) => String(o.sellerId || "") === sellerId);
      }
      if (!maybeAdmin && user && (user.uid || user.id)) {
        const uid = String(user.uid || user.id);
        items = items.filter((o) => [o.userId, o.buyerId, o.customerId].map((x) => String(x || "")).includes(uid));
      }
      items.sort((a, b) => __compatValueToMillis(b.createdAt || 0) - __compatValueToMillis(a.createdAt || 0));
      return res.json({ ok: true, orders: items });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "orders_list_failed" });
    }
  });

  app.get("/orders/:id", async (req, res) => {
    try {
      const maybeAdmin = await authAdminFromReq(req);
      const user = maybeAdmin ? null : await authUserFromReq(req);
      const id = String(req.params.id).trim();

      let order = null;
      const direct = await ordersCollection().doc(id).get().catch(() => null);
      order = snapData(direct);

      if (!order) {
        const list = await listCollection("orders");
        order = list.find((o) => String(o.id || o._id || "").startsWith(id) || String(o.orderId || o.code || o.shortId || "") === id) || null;
      }

      if (!order) return res.status(404).json({ ok: false, error: "order_not_found" });

      if (!maybeAdmin && user && (user.uid || user.id)) {
        const uid = String(user.uid || user.id);
        const ownerIds = [order.userId, order.buyerId, order.customerId].map((x) => String(x || ""));
        if (!ownerIds.includes(uid)) {
          return res.status(403).json({ ok: false, error: "order_forbidden" });
        }
      }

      return res.json({ ok: true, order });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "order_get_failed" });
    }
  });

  app.post("/orders", async (req, res) => {
    try {
      const body = req.body || {};
      const itemsRaw = Array.isArray(body.items) ? body.items : [];
      if (!itemsRaw.length) return res.status(400).json({ ok: false, error: "order_items_required" });

      const validatedItems = [];
      let subtotal = 0;
      for (const rawItem of itemsRaw) {
        const qty = Math.max(1, Number(rawItem.quantity || 1) || 1);
        const product = await findProductById(rawItem.productId || rawItem.id || rawItem._id);
        if (!product) {
          return res.status(400).json({ ok: false, error: `produto_invalido:${rawItem.productId || rawItem.id || ""}` });
        }
        const unitPrice = Number(product.price ?? product.preco ?? 0) || 0;
        const lineTotal = unitPrice * qty;
        subtotal += lineTotal;
        validatedItems.push({
          productId: product.id || product._id || rawItem.productId || rawItem.id,
          name: product.name || product.nome || rawItem.name || "Produto",
          image: product.imageUrl || product.image || product.mainImageUrl || rawItem.image || "",
          sellerId: rawItem.sellerId || product.sellerId || null,
          quantity: qty,
          price: unitPrice,
          lineTotal,
        });
      }

      const shipping = Number(body?.totals?.shipping ?? body.shipping ?? 0) || 0;
      const discount = Number(body?.totals?.discount ?? body.discount ?? 0) || 0;
      const total = Math.max(0, subtotal + shipping - discount);

      const ref = ordersCollection().doc();
      const orderPayload = {
        id: ref.id,
        userId: String(body.userId || body.buyerId || body.customerId || "").trim() || null,
        buyerId: String(body.buyerId || body.userId || body.customerId || "").trim() || null,
        customerId: String(body.customerId || body.userId || body.buyerId || "").trim() || null,
        buyerEmail: String(body.buyerEmail || body.email || "").trim().toLowerCase() || null,
        buyerName: String(body.buyerName || body.customerName || "").trim() || null,
        sellerId: String(body.sellerId || validatedItems[0]?.sellerId || "").trim() || null,
        items: validatedItems,
        totals: { subtotal, shipping, discount, total },
        subtotal,
        shipping,
        discount,
        total,
        payment: body.payment || { provider: "manual", status: "pending" },
        shippingAddress: body.shippingAddress || null,
        status: String(body.status || "pending").trim(),
        trackingCode: body.trackingCode || body.track || "",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await ref.set(orderPayload, { merge: true });

      const payment = orderPayload.payment || {};
      const method = String(payment.type || payment.method || payment.provider || "").toLowerCase();
      if (method.includes("pix")) {
        orderPayload.payment.pix = {
          qrCode: payment.qrCode || null,
          emv: payment.emv || null,
          expiresAt: payment.expiresAt || null,
        };
      }
      if (method.includes("boleto")) {
        orderPayload.payment.boleto = {
          barcode: payment.barcode || null,
          linhaDigitavel: payment.linhaDigitavel || null,
          expiresAt: payment.expiresAt || null,
        };
      }

      return res.status(201).json({ ok: true, id: ref.id, orderId: ref.id, data: orderPayload });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "order_create_failed" });
    }
  });

  app.get("/pedidos/rastrear", async (req, res) => {
    try {
      const code = String(req.query?.codigo || req.query?.trackingCode || req.query?.orderId || "").trim();
      if (!code) return res.status(400).json({ ok: false, error: "tracking_code_required" });

      const orders = await listCollection("orders");
      const order = orders.find((o) => [o.trackingCode, o.track, o.id, o.orderId].map((x) => String(x || "")).includes(code));
      if (!order) return res.status(404).json({ ok: false, error: "tracking_not_found" });

      const timeline = Array.isArray(order.timeline) ? order.timeline : [];
      return res.json({
        ok: true,
        orderId: order.id,
        trackingCode: order.trackingCode || order.track || null,
        status: order.status || null,
        timeline,
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "tracking_failed" });
    }
  });

  app.post("/shipping/calculate", async (req, res) => {
    try {
      const cep = String(req.body?.cep || req.body?.cepDestino || "").replace(/\D/g, "");
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      let pesoKg = Number(req.body?.pesoTotal || req.body?.pesoKg || 0) || 0;
      if (!pesoKg && items.length) {
        pesoKg = items.reduce((sum, item) => sum + ((Number(item.pesoKg || item.weight || 0) || 0) * (Number(item.quantity || 1) || 1)), 0);
      }
      if (!pesoKg) pesoKg = 1;

      const price = Math.max(19.9, (8.5 * pesoKg) + (cep.startsWith("39") ? 0 : 12));
      const deadlineDays = cep.startsWith("39") ? 2 : 6;

      return res.json({
        ok: true,
        cepDestino: cep,
        pesoKg,
        shipping: {
          service: "frete_padrao",
          price: Number(price.toFixed(2)),
          deadlineDays,
        },
        value: Number(price.toFixed(2)),
        prazo: deadlineDays,
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "shipping_calculate_failed" });
    }
  });

  app.post("/categories", async (req, res) => {
    try {
      const adminUser = await requireAdmin(req, res);
      if (!adminUser) return;
      const ref = categoryCollection().doc();
      const body = req.body || {};
      const payload = {
        id: ref.id,
        name: String(body.name || body.nome || "").trim(),
        description: String(body.description || body.descricao || "").trim(),
        slug: String(body.slug || normalizeSlug(body.name || body.nome || "")).trim(),
        parentId: body.parentId ? String(body.parentId) : null,
        level: Number(body.level ?? (body.parentId ? 1 : 0)) || 0,
        active: body.active !== false,
        order: Number(body.order ?? 0) || 0,
        createdByPanel: body.createdByPanel || "categories_panel_v1",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      await ref.set(payload, { merge: true });
      return res.status(201).json({ ok: true, id: ref.id, category: payload });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "category_create_failed" });
    }
  });

  app.put("/categories/:id", async (req, res) => {
    try {
      const adminUser = await requireAdmin(req, res);
      if (!adminUser) return;
      const ref = categoryCollection().doc(String(req.params.id));
      const snap = await ref.get();
      const current = snapData(snap);
      if (!current) return res.status(404).json({ ok: false, error: "category_not_found" });
      const body = req.body || {};
      const payload = {
        ...current,
        name: String(body.name ?? current.name ?? "").trim(),
        description: String(body.description ?? current.description ?? "").trim(),
        slug: String(body.slug || normalizeSlug(body.name ?? current.name ?? "")).trim(),
        parentId: body.parentId !== undefined ? (body.parentId ? String(body.parentId) : null) : (current.parentId || null),
        level: Number(body.level ?? ((body.parentId !== undefined ? body.parentId : current.parentId) ? 1 : 0)) || 0,
        active: body.active !== undefined ? body.active !== false : current.active !== false,
        order: Number(body.order ?? current.order ?? 0) || 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      await ref.set(payload, { merge: true });
      const updated = await ref.get();
      return res.json({ ok: true, category: snapData(updated) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "category_update_failed" });
    }
  });

  app.delete("/categories/:id", async (req, res) => {
    try {
      const adminUser = await requireAdmin(req, res);
      if (!adminUser) return;
      await categoryCollection().doc(String(req.params.id)).delete();
      return res.json({ ok: true });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "category_delete_failed" });
    }
  });

  app.get("/seller/products/list", async (req, res) => {
    try {
      const idsRaw = String(req.query?.ids || "").trim();
      if (!idsRaw) return res.json({ ok: true, items: [] });
      const ids = idsRaw.split(",").map((x) => String(x || "").trim()).filter(Boolean);
      const items = [];
      for (const id of ids) {
        const product = await findProductById(id);
        if (product) items.push(product);
      }
      return res.json({ ok: true, items });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "products_list_failed" });
    }
  });

  return app;
}



function toMillis(value) {
  if (!value) return null;
  if (typeof value === "number") return value;
  if (value && typeof value.toMillis === "function") return value.toMillis();
  const dt = new Date(value);
  const ms = dt.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function getByPath(obj, path) {
  try {
    return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
  } catch {
    return undefined;
  }
}

function normalizeStatusLabel(value) {
  return String(value || '').trim().toLowerCase() || 'desconhecido';
}

function bucketBy(items, getter) {
  const out = {};
  for (const item of items || []) {
    const key = getter(item) || 'desconhecido';
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function summarizeAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} d`;
}

async function loadRecentQueueDocs(db, limit = 300) {
  const snap = await db.collection("manufacturer_dispatch_queue").orderBy("updatedAt", "desc").limit(limit).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
}

async function loadRecentOrderDocs(db, limit = 300) {
  const snap = await db.collection("orders").orderBy("updatedAt", "desc").limit(limit).get().catch(async () => {
    return db.collection("orders").limit(limit).get();
  });
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
}

async function loadRecentAlertDocs(db, limit = 200) {
  const snap = await db.collection(OPERATIONAL_ALERT_COLLECTION).orderBy("updatedAt", "desc").limit(limit).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
}

async function loadRecentAuditDocs(db, limit = 250) {
  const snap = await db.collection(AUDIT_COLLECTION).orderBy("createdAt", "desc").limit(limit).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
}

function pickManufacturerFilter(filters) {
  const raw = filters.manufacturer || filters.fabricante || null;
  return raw ? String(raw).trim().toLowerCase() : null;
}

function filterByManufacturer(items, manufacturer) {
  if (!manufacturer) return items;
  return (items || []).filter((item) => String(item.manufacturer || item.integrationId || item.fabricante || '').trim().toLowerCase() === manufacturer);
}

async function buildQueueMonitoring(db, filters = {}) {
  const manufacturer = pickManufacturerFilter(filters);
  const rows = filterByManufacturer(await loadRecentQueueDocs(db, 400), manufacturer);
  const items = rows.map((row) => {
    const nextAttemptMs = toMillis(row.nextAttemptAt || row.queueNextAttemptAt);
    const updatedMs = toMillis(row.updatedAt || row.createdAt);
    return {
      id: row.id,
      orderId: row.orderId || null,
      manufacturer: row.manufacturer || null,
      status: row.status || 'pending',
      attempts: Number(row.attempts || row.retryAttempt || 0),
      maxAttempts: Number(row.maxAttempts || row.retryMaxAttempts || 0),
      nextAttemptAt: nextAttemptMs ? new Date(nextAttemptMs).toISOString() : null,
      updatedAt: updatedMs ? new Date(updatedMs).toISOString() : null,
      age: updatedMs ? summarizeAge(Date.now() - updatedMs) : null,
      lastError: row.lastError || row.error || null,
    };
  });
  return {
    manufacturer,
    count: items.length,
    byStatus: bucketBy(items, (x) => normalizeStatusLabel(x.status)),
    items,
  };
}

async function buildStuckOrdersMonitoring(db, filters = {}) {
  const manufacturer = pickManufacturerFilter(filters);
  const rows = filterByManufacturer(await loadRecentOrderDocs(db, 400), manufacturer);
  const stuckItems = rows
    .map((row) => {
      const md = row.manufacturerDispatch || {};
      const status = normalizeStatusLabel(md.status || row.status_integracao);
      const updatedMs = toMillis(md.finishedAt || md.startedAt || row.updatedAt || row.createdAt);
      const waitingReason = md.reason || row.status_integracao || null;
      const isStuck = [
        'waiting',
        'queued',
        'retrying',
        'erro_envio_fabricante',
        'fila_reenvio_fabricante',
        'fila_erro_fabricante',
        'aguardando_pre_requisitos',
      ].includes(status) || [
        'erro_envio_fabricante',
        'fila_reenvio_fabricante',
        'fila_erro_fabricante',
        'aguardando_pre_requisitos',
      ].includes(String(row.status_integracao || '').trim().toLowerCase());
      return {
        orderId: row.id,
        manufacturer: row.manufacturer || (row.integrationSnapshot && row.integrationSnapshot.manufacturer) || null,
        statusIntegracao: row.status_integracao || null,
        dispatchStatus: md.status || null,
        waitingReason,
        updatedAt: updatedMs ? new Date(updatedMs).toISOString() : null,
        age: updatedMs ? summarizeAge(Date.now() - updatedMs) : null,
        retryAttempt: Number(md.retryAttempt || md.queueAttempts || 0),
        retryMaxAttempts: Number(md.retryMaxAttempts || md.queueMaxAttempts || 0),
        orderIntegrationReady: row.orderIntegrationReady === true,
        antiFraudStatus: getByPath(row, 'antiFraud.status') || getByPath(row, 'orderIntegration.antiFraud.status') || null,
        isStuck,
      };
    })
    .filter((row) => row.isStuck);

  return {
    manufacturer,
    count: stuckItems.length,
    byStatus: bucketBy(stuckItems, (x) => normalizeStatusLabel(x.statusIntegracao || x.dispatchStatus)),
    items: stuckItems.slice(0, 200),
  };
}

async function buildRecentIntegrationErrors(db, filters = {}) {
  const manufacturer = pickManufacturerFilter(filters);
  const rows = filterByManufacturer(await loadRecentAuditDocs(db, 300), manufacturer)
    .filter((row) => {
      const status = normalizeStatusLabel(row.status);
      const statusCode = Number(row.statusCode || getByPath(row, 'response.statusCode') || 0);
      return status === 'error' || status === 'failed' || statusCode >= 400 || /erro|timeout|failed/i.test(JSON.stringify(row.response || row.metadata || {}));
    })
    .map((row) => ({
      id: row.id,
      createdAt: toMillis(row.createdAt) ? new Date(toMillis(row.createdAt)).toISOString() : null,
      manufacturer: row.manufacturer || null,
      orderId: row.orderId || null,
      eventType: row.eventType || null,
      status: row.status || null,
      statusCode: row.statusCode || getByPath(row, 'response.statusCode') || null,
      message: getByPath(row, 'response.error') || getByPath(row, 'metadata.error') || getByPath(row, 'response.body.error') || null,
    }));

  return {
    manufacturer,
    count: rows.length,
    byEventType: bucketBy(rows, (x) => normalizeStatusLabel(x.eventType)),
    items: rows,
  };
}

async function buildManufacturerHealth(db, filters = {}) {
  const manufacturer = pickManufacturerFilter(filters);
  const [queueRows, orderRows, alertRows, auditRows] = await Promise.all([
    loadRecentQueueDocs(db, 400),
    loadRecentOrderDocs(db, 400),
    loadRecentAlertDocs(db, 200),
    loadRecentAuditDocs(db, 300),
  ]);

  const manufacturers = new Set();
  for (const row of [...queueRows, ...orderRows, ...alertRows, ...auditRows]) {
    const name = String(row.manufacturer || row.integrationId || row.fabricante || ((row.integrationSnapshot || {}).manufacturer) || '').trim().toLowerCase();
    if (name) manufacturers.add(name);
  }

  const rows = [];
  for (const name of manufacturers) {
    if (manufacturer && name !== manufacturer) continue;
    const queueFor = queueRows.filter((x) => String(x.manufacturer || '').trim().toLowerCase() === name);
    const ordersFor = orderRows.filter((x) => String(x.manufacturer || ((x.integrationSnapshot || {}).manufacturer) || '').trim().toLowerCase() === name);
    const alertsFor = alertRows.filter((x) => String(x.manufacturer || '').trim().toLowerCase() === name && x.resolved !== true);
    const auditFor = auditRows.filter((x) => String(x.manufacturer || '').trim().toLowerCase() === name);

    const errorCount = auditFor.filter((x) => ['error', 'failed'].includes(normalizeStatusLabel(x.status)) || Number(x.statusCode || 0) >= 400).length;
    const deadLetterCount = queueFor.filter((x) => normalizeStatusLabel(x.status) === 'dead_letter').length;
    const queuedCount = queueFor.filter((x) => ['queued', 'retry_processing', 'retrying', 'pending'].includes(normalizeStatusLabel(x.status))).length;
    const successCount = auditFor.filter((x) => normalizeStatusLabel(x.status) === 'success').length;

    let health = 'healthy';
    if (deadLetterCount > 0 || alertsFor.some((x) => ['critical', 'high'].includes(String(x.severity || '').toLowerCase()))) health = 'critical';
    else if (errorCount >= 5 || queuedCount >= 10) health = 'degraded';
    else if (errorCount > 0 || alertsFor.length > 0) health = 'warning';

    rows.push({
      manufacturer: name,
      health,
      openAlerts: alertsFor.length,
      queuePending: queuedCount,
      queueDeadLetter: deadLetterCount,
      recentErrors: errorCount,
      recentSuccess: successCount,
      integrationOrders: ordersFor.length,
    });
  }

  rows.sort((a, b) => {
    const order = { critical: 0, degraded: 1, warning: 2, healthy: 3 };
    const map = { critical: 0, degraded: 1, warning: 2, healthy: 3 };
    return (map[a.health] ?? 99) - (map[b.health] ?? 99) || b.openAlerts - a.openAlerts || b.recentErrors - a.recentErrors;
  });

  return {
    manufacturer,
    count: rows.length,
    items: rows,
  };
}

async function buildMonitoringOverview(db, filters = {}) {
  const [health, queues, stuck, errors, alerts] = await Promise.all([
    buildManufacturerHealth(db, filters),
    buildQueueMonitoring(db, filters),
    buildStuckOrdersMonitoring(db, filters),
    buildRecentIntegrationErrors(db, filters),
    (async () => ({ items: filterByManufacturer(await loadRecentAlertDocs(db, 200), pickManufacturerFilter(filters)) }))(),
  ]);

  const openAlerts = (alerts.items || []).filter((x) => x.resolved !== true);
  const totals = {
    manufacturers: health.count || 0,
    queueItems: queues.count || 0,
    stuckOrders: stuck.count || 0,
    recentErrors: errors.count || 0,
    openAlerts: openAlerts.length,
    criticalAlerts: openAlerts.filter((x) => String(x.severity || '').toLowerCase() === 'critical').length,
  };

  return {
    generatedAt: new Date().toISOString(),
    totals,
    manufacturers: health.items,
    queue: {
      byStatus: queues.byStatus,
      items: queues.items.slice(0, 100),
    },
    stuckOrders: stuck.items.slice(0, 100),
    recentErrors: errors.items.slice(0, 100),
    alerts: openAlerts.slice(0, 100),
  };
}
function getApp() {
  if (_app) return _app;
  _app = buildApp();
  return _app;
}

// ================= EXPORTAÇÃO =================
exports.api = onRequest(
  {
    cors: true,
    timeoutSeconds: 60,
    secrets: [
      "MP_ACCESS_TOKEN",
      "MP_PUBLIC_KEY",
      "CORREIOS_USER",
      "CORREIOS_PASS",
      "CORREIOS_CARTAO",
      "SENDGRID_API_KEY",
      "EMAIL_FROM",
      "PAGARME_SECRET_KEY",
      "PAGARME_MARKETPLACE_RECIPIENT_ID",
      "PAGARME_API_BASE",
      "PAGARME_SOFT_DESCRIPTOR",
      "PAGARME_WEBHOOK_TOKEN"
    ],
  },
  (req, res) => getApp()(req, res)
);

exports.notifyOrderStatusOnWhatsApp = onDocumentWritten(
  { document: "orders/{orderId}" },
  async (event) => {
    const orderId = String(event.params?.orderId || "").trim();
    const before = event.data?.before?.exists ? (event.data.before.data() || {}) : {};
    const after = event.data?.after?.exists ? (event.data.after.data() || {}) : null;
    if (!orderId || !after) return;
    try {
      await waMaybeNotifyOrderStatusChange(orderId, before, { id: orderId, ...after }, "trigger");
    } catch (error) {
      console.error("[whatsapp trigger] erro:", error?.message || error);
      await adminGlobal.firestore().collection("orders").doc(orderId).set({
        whatsappNotification: {
          lastAttemptAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
          lastError: error?.message || String(error),
          origin: "trigger",
        },
      }, { merge: true }).catch(() => null);
      await writeAuditLog({
        scope: "whatsapp_evolution",
        eventType: "order_status_whatsapp_failed",
        orderId,
        status: "error",
        message: error?.message || String(error),
        metadata: { origin: "trigger" },
      });
    }
  }
);

// ================= TRIGGER: sincroniza sellers -> sellers_public =================
// Garante que TODO seller cadastrado/atualizado tenha o espelho público (para página da loja, nome no produto, etc.)
exports.syncSellerPublic = onDocumentWritten(
  { document: "sellers/{sellerId}" },
  async (event) => {
    const sellerId = event.params.sellerId;
    const after = event.data?.after;

    const pubRef = adminGlobal.firestore().doc(`sellers_public/${sellerId}`);

    // Se deletou o seller, remove o público também
    if (!after || !after.exists) {
      await pubRef.delete().catch(() => null);
      return;
    }

    const d = after.data() || {};

    // Mapeamento robusto (cada tela pode salvar nomes diferentes)
    const storeName =
      (d.storeName || d.nomeFantasia || d.factoryName || d.displayName || d.name || "").toString().trim() ||
      (d.email ? String(d.email).split("@")[0] : "");

    const whatsapp =
      (d.whatsapp || d.whats || d.phone || d.telefone || d.telefoneWhatsapp || "").toString().replace(/\D/g, "");

    const city =
      (d.city || d.cidade || d.municipio || d.location?.city || d.address?.city || "").toString().trim();

    const uf =
      (d.uf || d.state || d.estado || d.location?.uf || d.address?.uf || "").toString().trim();

    const payload = {
      sellerId,
      active: d.active === true,
      storeName,
      whatsapp: whatsapp || null,
      bio: (d.bioPublica || d.bio || d.description || "").toString().trim() || null,
      logoUrl: d.logoUrl || d.logo || d.avatarUrl || null,
      bannerUrl: d.bannerUrl || d.coverUrl || null,
      city: city || null,
      uf: uf || null,
      updatedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
    };

    await pubRef.set(payload, { merge: true });
  }
);


// ================= TRIGGER: padroniza orders para integração com fabricantes =================
exports.normalizeManufacturerOrder = onDocumentWritten(
  { document: "orders/{orderId}" },
  async (event) => {
    const orderId = String(event.params?.orderId || "").trim();
    const after = event.data?.after;
    if (!after || !after.exists || !orderId) return;

    const data = after.data() || {};
    if (data?.orderIntegrationNormalized === true) return;

    const manufacturer = String(
      data.manufacturer || data.fabricante || data.vendedor_id || data.sellerId || ""
    ).toLowerCase();

    const items = Array.isArray(data.items)
      ? data.items
      : Array.isArray(data.itens)
        ? data.itens
        : [];

    const patch = {
      orderIntegrationNormalized: true,
      integrationSnapshot: {
        manufacturer: manufacturer || null,
        sku_fabricante: data.sku_fabricante || data.sku || items?.[0]?.sku_fabricante || items?.[0]?.sku || null,
        antiFraudStatus: data.antiFraud?.status || data.antifraude_status || null,
        nfeStatus: data.fiscal?.nfeStatus || data.fiscal_status || null,
        deliveryStatus: data.tracking?.status || data.status_entrega || null,
        status_integracao: data.status_integracao || null,
        updatedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
      },
      updatedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
    };

    await adminGlobal.firestore().collection("orders").doc(orderId).set(patch, { merge: true });
    await adminGlobal.firestore().collection("pedidos").doc(orderId).set(patch, { merge: true });
  }
);


// ================= AUTO DISPATCH ENTERPRISE =================
const axiosAuto = require("axios");

function autoSlugifyVendor(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const AUTO_MANUFACTURER_ALIASES = {
  samsung: ["samsung", "samsung_oficial", "samsung_eletronics", "allied_samsung"],
  motorola: ["motorola", "motorola_oficial", "motorola_mobility", "lenovo_motorola"],
  whirlpool: ["whirlpool", "whirlpool_oficial", "brastemp", "consul", "kitchenaid", "maytag"],
  lg: ["lg", "lg_electronics", "lge", "lg_oficial"],
  electrolux: ["electrolux", "electrolux_oficial", "electrolux_do_brasil"],
  midea: ["midea", "midea_carrier", "carrier_midea", "springer_midea", "comfee"],
  philips: ["philips", "philips_walita", "walita", "versuni"],
  panasonic: ["panasonic", "panasonic_do_brasil"],
  sony: ["sony", "sony_brasil"],
  tcl: ["tcl", "tcl_semp", "semp_tcl", "semp"],
  hisense: ["hisense"],
  dell: ["dell", "dell_technologies"],
  hp: ["hp", "hewlett_packard", "hp_inc"],
  lenovo: ["lenovo"],
  acer: ["acer"],
  asus: ["asus"],
  apple: ["apple", "apple_brasil"],
  intelbras: ["intelbras"],
  xiaomi: ["xiaomi"],
  realme: ["realme"],
  oppo: ["oppo"],
  vivo_mobile: ["vivo", "vivo_mobile", "vivo_global"],
  britania: ["britania", "philco", "philco_britania"],
  mondial: ["mondial"],
  arno: ["arno", "groupe_seb", "seb"],
  black_decker: ["black_decker", "black_and_decker"],
  bosch: ["bosch", "bsh", "continental", "bosch_home"],
  ge_appliances: ["ge", "ge_appliances", "haier", "haier_ge"],
  mallory: ["mallory"],
  cadence: ["cadence"],
  fisher_paykel: ["fisher_paykel", "fisherpaykel"],
  generic: ["generic", "generico"],
};

const AUTO_PROFILE_DEFAULTS = {
  samsung: { payloadMode: "retail_json", contentType: "application/json" },
  motorola: { payloadMode: "flat_json", contentType: "application/json" },
  whirlpool: { payloadMode: "whirlpool_json", contentType: "application/json" },
  lg: { payloadMode: "retail_json", contentType: "application/json" },
  electrolux: { payloadMode: "retail_json", contentType: "application/json" },
  midea: { payloadMode: "retail_json", contentType: "application/json" },
  philips: { payloadMode: "flat_json", contentType: "application/json" },
  panasonic: { payloadMode: "retail_json", contentType: "application/json" },
  sony: { payloadMode: "flat_json", contentType: "application/json" },
  tcl: { payloadMode: "retail_json", contentType: "application/json" },
  hisense: { payloadMode: "retail_json", contentType: "application/json" },
  dell: { payloadMode: "retail_json", contentType: "application/json" },
  hp: { payloadMode: "retail_json", contentType: "application/json" },
  lenovo: { payloadMode: "retail_json", contentType: "application/json" },
  acer: { payloadMode: "retail_json", contentType: "application/json" },
  asus: { payloadMode: "retail_json", contentType: "application/json" },
  apple: { payloadMode: "retail_json", contentType: "application/json" },
  intelbras: { payloadMode: "flat_json", contentType: "application/json" },
  xiaomi: { payloadMode: "flat_json", contentType: "application/json" },
  realme: { payloadMode: "flat_json", contentType: "application/json" },
  oppo: { payloadMode: "flat_json", contentType: "application/json" },
  vivo_mobile: { payloadMode: "flat_json", contentType: "application/json" },
  britania: { payloadMode: "nested_json", contentType: "application/json" },
  mondial: { payloadMode: "nested_json", contentType: "application/json" },
  arno: { payloadMode: "nested_json", contentType: "application/json" },
  black_decker: { payloadMode: "nested_json", contentType: "application/json" },
  bosch: { payloadMode: "soap_like_xml", contentType: "application/xml" },
  ge_appliances: { payloadMode: "nested_json", contentType: "application/json" },
  mallory: { payloadMode: "nested_json", contentType: "application/json" },
  cadence: { payloadMode: "nested_json", contentType: "application/json" },
  fisher_paykel: { payloadMode: "soap_like_xml", contentType: "application/xml" },
  generic: { payloadMode: "generic_json", contentType: "application/json" },
};

function autoNormalizeManufacturerKey(value) {
  const s = autoSlugifyVendor(value);
  if (!s) return "generic";
  for (const [canonical, aliases] of Object.entries(AUTO_MANUFACTURER_ALIASES)) {
    if (canonical === s || aliases.includes(s)) return canonical;
  }
  if (s.includes("samsung")) return "samsung";
  if (s.includes("motorola")) return "motorola";
  if (s.includes("whirlpool") || s.includes("brastemp") || s.includes("consul") || s.includes("kitchenaid") || s.includes("maytag")) return "whirlpool";
  if (s.includes("electrolux")) return "electrolux";
  if (s.includes("midea") || s.includes("carrier") || s.includes("comfee")) return "midea";
  if (s === "lg" || s.includes("lg_electronics") || s.includes("lge")) return "lg";
  if (s.includes("philips") || s.includes("walita") || s.includes("versuni")) return "philips";
  if (s.includes("panasonic")) return "panasonic";
  if (s.includes("sony")) return "sony";
  if (s.includes("tcl") || s.includes("semp")) return "tcl";
  if (s.includes("hisense")) return "hisense";
  if (s === "hp" || s.includes("hewlett_packard")) return "hp";
  if (s.includes("dell")) return "dell";
  if (s.includes("lenovo")) return "lenovo";
  if (s.includes("acer")) return "acer";
  if (s.includes("asus")) return "asus";
  if (s.includes("apple")) return "apple";
  if (s.includes("intelbras")) return "intelbras";
  if (s.includes("xiaomi")) return "xiaomi";
  if (s.includes("realme")) return "realme";
  if (s.includes("oppo")) return "oppo";
  if (s === "vivo" || s.includes("vivo_mobile")) return "vivo_mobile";
  if (s.includes("britania") || s.includes("philco")) return "britania";
  if (s.includes("mondial")) return "mondial";
  if (s.includes("arno") || s.includes("groupe_seb") || s === "seb") return "arno";
  if (s.includes("black_decker") || s.includes("black_and_decker")) return "black_decker";
  if (s.includes("bosch") || s === "bsh" || s.includes("continental")) return "bosch";
  if (s === "ge" || s.includes("ge_appliances") || s.includes("haier")) return "ge_appliances";
  if (s.includes("mallory")) return "mallory";
  if (s.includes("cadence")) return "cadence";
  if (s.includes("fisher_paykel") || s.includes("fisherpaykel")) return "fisher_paykel";
  return s;
}

function autoEnvFirst(...keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function autoManufacturerPrefix(manufacturer) {
  return autoNormalizeManufacturerKey(manufacturer).toUpperCase();
}

async function autoGetManufacturerProfile(manufacturer) {
  const key = autoNormalizeManufacturerKey(manufacturer);
  const defaults = AUTO_PROFILE_DEFAULTS[key] || AUTO_PROFILE_DEFAULTS.generic;
  let firestoreCfg = null;

  try {
    const snap = await adminGlobal.firestore().collection("manufacturer_integrations").doc(key).get();
    if (snap.exists) firestoreCfg = snap.data() || null;
  } catch (e) {
    console.warn("[auto-dispatch] Falha ao ler manufacturer_integrations:", e?.message || e);
  }

  const prefix = autoManufacturerPrefix(key);
  const aliases = Array.isArray(firestoreCfg?.aliases)
    ? firestoreCfg.aliases.map((x) => autoNormalizeManufacturerKey(x)).filter(Boolean)
    : (AUTO_MANUFACTURER_ALIASES[key] || []);

  return {
    manufacturer: key,
    aliases,
    isEnabled: firestoreCfg?.isEnabled !== false,
    endpoint: String(firestoreCfg?.api_endpoint || firestoreCfg?.apiEndpoint || autoEnvFirst(`${prefix}_API_ENDPOINT`)).trim(),
    sandboxEndpoint: String(firestoreCfg?.sandbox_endpoint || firestoreCfg?.sandboxEndpoint || autoEnvFirst(`${prefix}_SANDBOX_ENDPOINT`)).trim(),
    token: String(firestoreCfg?.api_token || firestoreCfg?.apiToken || autoEnvFirst(`${prefix}_API_TOKEN`)).trim(),
    sandboxToken: String(firestoreCfg?.sandbox_token || firestoreCfg?.sandboxToken || autoEnvFirst(`${prefix}_SANDBOX_TOKEN`)).trim(),
    authHeader: String(firestoreCfg?.auth_header || firestoreCfg?.authHeader || autoEnvFirst(`${prefix}_AUTH_HEADER`) || "Authorization").trim(),
    authScheme: String(firestoreCfg?.auth_scheme || firestoreCfg?.authScheme || autoEnvFirst(`${prefix}_AUTH_SCHEME`) || "Bearer").trim(),
    contentType: String(firestoreCfg?.content_type || firestoreCfg?.contentType || autoEnvFirst(`${prefix}_CONTENT_TYPE`) || defaults.contentType).trim().toLowerCase(),
    payloadMode: String(firestoreCfg?.payload_mode || firestoreCfg?.payloadMode || autoEnvFirst(`${prefix}_PAYLOAD_MODE`) || defaults.payloadMode).trim().toLowerCase(),
    useSandbox: firestoreCfg?.useSandbox === true || autoEnvFirst(`${prefix}_USE_SANDBOX`) === "true",
    source: firestoreCfg ? "firestore" : "env",
  };
}

function autoSafeString(v) {
  return String(v || "").trim();
}

function autoDigits(v) {
  return String(v || "").replace(/\D/g, "");
}

function autoNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function autoItems(order) {
  const items = Array.isArray(order.items) ? order.items : (Array.isArray(order.itens) ? order.itens : []);
  if (items.length) return items;
  return [{
    sku_fabricante: order.sku_fabricante || order.sku || null,
    quantity: autoNumber(order.quantity || order.qty || 1, 1),
    unitPrice: autoNumber(order.price || order.valor || order.total || 0, 0),
    name: order.productName || order.nome || null,
  }];
}

function autoPreparedOrder(order) {
  const items = autoItems(order);
  const customer = order.customer || {};
  const shippingAddress = order.shippingAddress || order.enderecoEntrega || order.endereco || {};
  const billing = order.billing || {};
  return {
    orderId: autoSafeString(order.orderId || order.id || order.external_id || order.id_externo),
    manufacturer: autoNormalizeManufacturerKey(order.manufacturer || order.fabricante || order.vendedor_id || order.sellerId || order.seller_id),
    customer: {
      nome: autoSafeString(customer.nome || order.nome || order.customerName),
      email: autoSafeString(customer.email || order.email),
      cpf: autoDigits(customer.cpf || order.cpf),
      telefone: autoDigits(customer.telefone || order.telefone || order.phone),
    },
    shippingAddress: {
      cep: autoDigits(shippingAddress.cep || order.cep_cliente || order.cep),
      logradouro: autoSafeString(shippingAddress.logradouro || order.logradouro || order.address1),
      numero: autoSafeString(shippingAddress.numero || order.numero_casa || order.numero),
      complemento: autoSafeString(shippingAddress.complemento || order.complemento),
      bairro: autoSafeString(shippingAddress.bairro || order.bairro),
      cidade: autoSafeString(shippingAddress.cidade || order.cidade),
      uf: autoSafeString(shippingAddress.uf || order.uf),
      pais: autoSafeString(shippingAddress.pais || order.pais || "BR"),
    },
    billing: {
      subtotal: autoNumber(billing.subtotal || order.subtotal || order.valor_produtos || 0, 0),
      shipping: autoNumber(billing.shipping || order.shipping || order.frete || 0, 0),
      discount: autoNumber(billing.discount || order.discount || order.desconto || 0, 0),
      total: autoNumber(billing.total || order.total || order.valor_total || 0, 0),
      currency: autoSafeString(billing.currency || order.currency || "BRL") || "BRL",
      paymentMethod: autoSafeString(billing.paymentMethod || order.paymentMethod || order.metodo_pagamento),
      installments: autoNumber(billing.installments || order.installments || order.parcelas || 1, 1),
    },
    antiFraud: {
      provider: autoSafeString(order.antiFraud?.provider || order.antiFraudProvider || order.antifraude_provider),
      status: autoSafeString(order.antiFraud?.status || order.antiFraudStatus || order.antifraude_status || "pendente").toLowerCase(),
      score: order.antiFraud?.score ?? order.antiFraudScore ?? order.antifraude_score ?? null,
      analysisId: autoSafeString(order.antiFraud?.analysisId || order.antiFraudId || order.antifraude_id),
    },
    fiscal: {
      nfeStatus: autoSafeString(order.fiscal?.nfeStatus || order.nfeStatus || order.fiscal_status || "pendente").toLowerCase(),
    },
    logistics: {
      deliveryType: autoSafeString(order.logistics?.deliveryType || order.deliveryType || "fabricante"),
    },
    items,
    raw: order,
  };
}

function autoToXmlPrepared(prepared) {
  const itemXml = prepared.items.map((item) => `
    <item>
      <sku>${autoSafeString(item.sku_fabricante || item.sku)}</sku>
      <quantity>${autoNumber(item.quantity || item.qty || 1, 1)}</quantity>
      <unitPrice>${autoNumber(item.unitPrice || item.price || 0, 0)}</unitPrice>
      <name>${autoSafeString(item.name || item.nome)}</name>
    </item>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<order>
  <externalId>${prepared.orderId}</externalId>
  <manufacturer>${prepared.manufacturer}</manufacturer>
  <customer>
    <name>${prepared.customer.nome}</name>
    <email>${prepared.customer.email}</email>
    <cpf>${prepared.customer.cpf}</cpf>
    <phone>${prepared.customer.telefone}</phone>
  </customer>
  <shipping>
    <zip>${prepared.shippingAddress.cep}</zip>
    <street>${prepared.shippingAddress.logradouro}</street>
    <number>${prepared.shippingAddress.numero}</number>
    <district>${prepared.shippingAddress.bairro}</district>
    <city>${prepared.shippingAddress.cidade}</city>
    <state>${prepared.shippingAddress.uf}</state>
    <country>${prepared.shippingAddress.pais}</country>
  </shipping>
  <billing>
    <subtotal>${prepared.billing.subtotal}</subtotal>
    <shipping>${prepared.billing.shipping}</shipping>
    <discount>${prepared.billing.discount}</discount>
    <total>${prepared.billing.total}</total>
    <currency>${prepared.billing.currency}</currency>
    <paymentMethod>${prepared.billing.paymentMethod}</paymentMethod>
    <installments>${prepared.billing.installments}</installments>
  </billing>
  <items>${itemXml}
  </items>
</order>`;
}

function autoToEdiPrepared(prepared) {
  const header = [
    "ISA*00*          *00*          *ZZ*ARIANAMOVEIS   *ZZ*" + prepared.manufacturer.toUpperCase().padEnd(15, " "),
    "*260313*1030*U*00401*000000001*0*T*>",
    "GS*PO*ARIANAMOVEIS*" + prepared.manufacturer.toUpperCase() + "*20260313*1030*1*X*004010",
    "ST*850*0001",
    `BEG*00*NE*${prepared.orderId}**20260313`,
    `REF*CO*${prepared.orderId}`,
    `N1*BT*${prepared.customer.nome}`,
    `PER*IC**TE*${prepared.customer.telefone}*EM*${prepared.customer.email}`,
    `N3*${prepared.shippingAddress.logradouro}, ${prepared.shippingAddress.numero}`,
    `N4*${prepared.shippingAddress.cidade}*${prepared.shippingAddress.uf}*${prepared.shippingAddress.cep}*${prepared.shippingAddress.pais}`,
  ];
  const lines = prepared.items.map((item, idx) => {
    const sku = autoSafeString(item.sku_fabricante || item.sku);
    const qty = autoNumber(item.quantity || item.qty || 1, 1);
    const price = autoNumber(item.unitPrice || item.price || 0, 0).toFixed(2);
    return `PO1*${idx + 1}*${qty}*EA*${price}**VP*${sku}`;
  });
  const trailer = ["CTT*" + prepared.items.length, "SE*" + (header.length + lines.length + 2) + "*0001", "GE*1*1", "IEA*1*000000001"];
  return [...header, ...lines, ...trailer].join("~");
}

function autoFormatManufacturerPayload(order, profile) {
  const prepared = autoPreparedOrder(order);
  const firstItem = prepared.items[0] || {};
  const retailJson = {
    external_id: prepared.orderId,
    manufacturer: prepared.manufacturer,
    customer: {
      name: prepared.customer.nome,
      email: prepared.customer.email,
      cpf: prepared.customer.cpf,
      phone: prepared.customer.telefone,
    },
    shipping_address: {
      zip: prepared.shippingAddress.cep,
      street: prepared.shippingAddress.logradouro,
      number: prepared.shippingAddress.numero,
      complement: prepared.shippingAddress.complemento,
      district: prepared.shippingAddress.bairro,
      city: prepared.shippingAddress.cidade,
      state: prepared.shippingAddress.uf,
      country: prepared.shippingAddress.pais,
    },
    billing: prepared.billing,
    items: prepared.items.map((item) => ({
      product_code: item.sku_fabricante || item.sku || null,
      sku: item.sku_fabricante || item.sku || null,
      quantity: autoNumber(item.quantity || item.qty || 1, 1),
      unit_price: autoNumber(item.unitPrice || item.price || 0, 0),
      name: item.name || item.nome || null,
    })),
  };

  switch (profile.payloadMode) {
    case "flat_json":
      return {
        contentType: "application/json",
        body: {
          external_id: prepared.orderId,
          customer_cpf: prepared.customer.cpf,
          customer_name: prepared.customer.nome,
          customer_email: prepared.customer.email,
          customer_phone: prepared.customer.telefone,
          product_code: firstItem.sku_fabricante || firstItem.sku || null,
          quantity: autoNumber(firstItem.quantity || firstItem.qty || 1, 1),
          delivery_zip: prepared.shippingAddress.cep,
          delivery_address: prepared.shippingAddress,
          total: prepared.billing.total,
        },
      };
    case "whirlpool_json":
      return {
        contentType: "application/json",
        body: {
          orderData: {
            externalId: prepared.orderId,
            customer: retailJson.customer,
            sku: firstItem.sku_fabricante || firstItem.sku || null,
            quantity: autoNumber(firstItem.quantity || firstItem.qty || 1, 1),
            shipping: {
              zip: prepared.shippingAddress.cep,
              street: prepared.shippingAddress.logradouro,
              number: prepared.shippingAddress.numero,
              district: prepared.shippingAddress.bairro,
              city: prepared.shippingAddress.cidade,
              state: prepared.shippingAddress.uf,
            },
            payment: {
              total: prepared.billing.total,
              method: prepared.billing.paymentMethod,
              installments: prepared.billing.installments,
            },
            items: retailJson.items,
          },
        },
      };
    case "nested_json":
      return {
        contentType: "application/json",
        body: {
          order: retailJson,
        },
      };
    case "soap_like_xml":
      return {
        contentType: "application/xml",
        body: autoToXmlPrepared(prepared),
      };
    case "edi_x12":
      return {
        contentType: "application/edi-x12",
        body: autoToEdiPrepared(prepared),
      };
    case "generic_json":
    case "retail_json":
    default:
      return {
        contentType: "application/json",
        body: retailJson,
      };
  }
}

function autoEligibilityReason(order) {
  const antiStatus = autoSafeString(order.antiFraud?.status || order.antiFraudStatus || order.antifraude_status).toLowerCase();
  const nfeStatus = autoSafeString(order.fiscal?.nfeStatus || order.nfeStatus || order.fiscal_status).toLowerCase();
  const integrationReady = order.orderIntegrationReady === true;
  const hasManufacturer = Boolean(order.manufacturer || order.fabricante || order.vendedor_id || order.sellerId);
  const dispatched = autoSafeString(order.manufacturerDispatch?.status || order.dispatch_status || order.status_integracao).toLowerCase();

  if (!hasManufacturer) return "sem_fabricante";
  if (!integrationReady) return "orderIntegrationReady_false";
  if (["success", "sent", "processing", "queued", "delivered_to_manufacturer"].includes(dispatched)) return "ja_em_fluxo";
  if (antiStatus && !["aprovado", "approved", "skip", "skipped", "not_required", "nao_aplicavel", "nao_aplicavel"].includes(antiStatus)) return `antifraude_${antiStatus}`;
  if (nfeStatus && !["pendente", "pending", "ok", "emitida", "issued", "skip", "not_required"].includes(nfeStatus)) return `fiscal_${nfeStatus}`;
  return "";
}

async function autoMergeOrderAndPedido(orderId, patch) {
  const payload = { ...patch, updatedAt: adminGlobal.firestore.FieldValue.serverTimestamp() };
  await adminGlobal.firestore().collection("orders").doc(orderId).set(payload, { merge: true });
  await adminGlobal.firestore().collection("pedidos").doc(orderId).set(payload, { merge: true });
}

async function autoDispatchOrder(orderId, orderData) {
  const profile = await autoGetManufacturerProfile(orderData.manufacturer || orderData.fabricante || orderData.vendedor_id || orderData.sellerId);
  if (profile.isEnabled === false) throw new Error(`Integração desativada para ${profile.manufacturer}`);

  const endpoint = profile.useSandbox && profile.sandboxEndpoint ? profile.sandboxEndpoint : profile.endpoint;
  const token = profile.useSandbox && profile.sandboxToken ? profile.sandboxToken : profile.token;
  if (!endpoint) throw new Error(`Endpoint não configurado para ${profile.manufacturer}`);

  const formatted = autoFormatManufacturerPayload({ ...orderData, orderId }, profile);
  const headers = { "Content-Type": formatted.contentType || profile.contentType || "application/json" };
  if (token) headers[profile.authHeader || "Authorization"] = profile.authScheme ? `${profile.authScheme} ${token}` : token;

  const response = await axiosAuto({
    method: "POST",
    url: endpoint,
    timeout: 30000,
    headers,
    data: formatted.body,
    validateStatus: () => true,
  });

  return {
    manufacturer: profile.manufacturer,
    endpoint,
    source: profile.source,
    payloadMode: profile.payloadMode,
    sentContentType: formatted.contentType,
    ok: response.status >= 200 && response.status < 300,
    statusCode: response.status,
    responseData: response.data || null,
    requestBody: formatted.body,
  };
}

exports.autoDispatchManufacturerOrder = onDocumentWritten(
  { document: "orders/{orderId}", retry: false },
  async (event) => {
    const orderId = String(event.params?.orderId || "").trim();
    const after = event.data?.after;
    if (!after || !after.exists || !orderId) return;

    const data = after.data() || {};
    const reason = autoEligibilityReason(data);

    if (reason) {
      if (reason !== "ja_em_fluxo") {
        await autoMergeOrderAndPedido(orderId, {
          manufacturerDispatch: {
            status: "waiting",
            reason,
            lastCheckedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
          },
          status_integracao: data.status_integracao || "aguardando_pre_requisitos",
        });
      }
      return;
    }

    await autoMergeOrderAndPedido(orderId, {
      manufacturerDispatch: {
        status: "processing",
        startedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
      },
      status_integracao: "enviando_para_fabricante",
    });

    try {
      const result = await autoDispatchOrder(orderId, data);
      await autoMergeOrderAndPedido(orderId, {
        manufacturerDispatch: {
          status: result.ok ? "success" : "error",
          manufacturer: result.manufacturer,
          endpoint: result.endpoint,
          source: result.source,
          payloadMode: result.payloadMode,
          sentContentType: result.sentContentType,
          statusCode: result.statusCode,
          responseData: result.responseData,
          finishedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
        },
        status_integracao: result.ok ? "enviado_ao_fabricante" : "erro_envio_fabricante",
        integrationSnapshot: {
          manufacturer: result.manufacturer,
          dispatchStatus: result.ok ? "success" : "error",
          manufacturerStatusCode: result.statusCode,
          updatedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
        },
      });

      if (!result.ok) {
        await enqueueManufacturerRetry(orderId, {
          manufacturer: result.manufacturer,
          reason: `http_${result.statusCode || 0}`,
          statusCode: result.statusCode || null,
          responseData: result.responseData || null,
        });
      }
    } catch (error) {
      await autoMergeOrderAndPedido(orderId, {
        manufacturerDispatch: {
          status: "error",
          errorMessage: error?.message || String(error),
          finishedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
        },
        status_integracao: "erro_envio_fabricante",
      });

      await enqueueManufacturerRetry(orderId, {
        manufacturer: data.manufacturer || data.fabricante || data.vendedor_id || data.sellerId || null,
        reason: "exception",
        errorMessage: error?.message || String(error),
      });
    }
  }
);


function retryBackoffMinutes(attempt) {
  const n = Number(attempt || 0);
  if (n <= 1) return 5;
  if (n === 2) return 15;
  if (n === 3) return 30;
  if (n === 4) return 60;
  if (n === 5) return 180;
  return 360;
}

function tsPlusMinutes(minutes) {
  const ms = Date.now() + (Number(minutes || 0) * 60 * 1000);
  return adminGlobal.firestore.Timestamp.fromDate(new Date(ms));
}

async function enqueueManufacturerRetry(orderId, data = {}) {
  const id = `${String(orderId || '').trim()}_main`;
  if (!orderId) return null;
  const ref = adminGlobal.firestore().collection("manufacturer_dispatch_queue").doc(id);
  const snap = await ref.get();
  const prev = snap.exists ? (snap.data() || {}) : {};
  const attempts = Number(prev.attempts || 0);
  const maxAttempts = Math.max(1, Math.min(Number(prev.maxAttempts || data.maxAttempts || 7), 20));
  const nextAttemptAt = tsPlusMinutes(retryBackoffMinutes(attempts + 1));

  await ref.set({
    orderId: String(orderId),
    manufacturer: data.manufacturer || prev.manufacturer || null,
    status: attempts + 1 >= maxAttempts ? "dead_letter" : "pending",
    attempts,
    maxAttempts,
    nextAttemptAt,
    lastError: data.errorMessage || data.reason || prev.lastError || null,
    lastStatusCode: data.statusCode || null,
    lastResponseData: data.responseData || null,
    updatedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
    createdAt: prev.createdAt || adminGlobal.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  await autoMergeOrderAndPedido(String(orderId), {
    manufacturerDispatch: {
      status: attempts + 1 >= maxAttempts ? "dead_letter" : "queued",
      queueId: id,
      queueNextAttemptAt: nextAttemptAt,
      queueReason: data.reason || data.errorMessage || null,
      queueAttempts: attempts,
      queueMaxAttempts: maxAttempts,
      queuedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
    },
    status_integracao: attempts + 1 >= maxAttempts ? "fila_erro_fabricante" : "fila_reenvio_fabricante",
  });

  return id;
}

exports.processManufacturerDispatchQueue = onDocumentWritten(
  { document: "manufacturer_dispatch_queue/{queueId}", retry: false },
  async (event) => {
    const queueId = String(event.params?.queueId || "").trim();
    const after = event.data?.after;
    if (!after || !after.exists || !queueId) return;

    const queue = after.data() || {};
    const status = String(queue.status || "").toLowerCase();
    const attempts = Number(queue.attempts || 0);
    const maxAttempts = Math.max(1, Number(queue.maxAttempts || 7));
    const orderId = String(queue.orderId || "").trim();
    if (!orderId) return;
    if (!["pending", "retrying", "processing"].includes(status)) return;

    const nowMs = Date.now();
    const nextAt = queue.nextAttemptAt && typeof queue.nextAttemptAt.toMillis === "function"
      ? queue.nextAttemptAt.toMillis()
      : 0;
    if (nextAt && nextAt > nowMs) return;
    if (attempts >= maxAttempts && status !== "processing") {
      await after.ref.set({
        status: "dead_letter",
        updatedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }

    const orderSnap = await adminGlobal.firestore().collection("orders").doc(orderId).get();
    if (!orderSnap.exists) {
      await after.ref.set({
        status: "dead_letter",
        lastError: "pedido_nao_encontrado",
        updatedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }

    const order = orderSnap.data() || {};
    const currentDispatch = String(order.manufacturerDispatch?.status || "").toLowerCase();
    if (["success", "sent"].includes(currentDispatch)) {
      await after.ref.set({
        status: "success",
        updatedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }

    await after.ref.set({
      status: "processing",
      attempts: attempts + 1,
      processingStartedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
      updatedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    await autoMergeOrderAndPedido(orderId, {
      manufacturerDispatch: {
        status: "retry_processing",
        queueId,
        retryAttempt: attempts + 1,
        retryMaxAttempts: maxAttempts,
        startedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
      },
      status_integracao: "reprocessando_envio_fabricante",
    });

    try {
      const result = await autoDispatchOrder(orderId, order);
      if (result.ok) {
        await after.ref.set({
          status: "success",
          finishedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
          lastStatusCode: result.statusCode || null,
          lastResponseData: result.responseData || null,
          updatedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        await autoMergeOrderAndPedido(orderId, {
          manufacturerDispatch: {
            status: "success",
            queueId,
            retryAttempt: attempts + 1,
            manufacturer: result.manufacturer,
            statusCode: result.statusCode,
            responseData: result.responseData,
            finishedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
          },
          status_integracao: "enviado_ao_fabricante",
        });
        return;
      }

      const willDeadLetter = attempts + 1 >= maxAttempts;
      const nextAttemptAt = tsPlusMinutes(retryBackoffMinutes(attempts + 1));
      await after.ref.set({
        status: willDeadLetter ? "dead_letter" : "retrying",
        nextAttemptAt,
        finishedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
        lastStatusCode: result.statusCode || null,
        lastResponseData: result.responseData || null,
        lastError: `http_${result.statusCode || 0}`,
        updatedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      await autoMergeOrderAndPedido(orderId, {
        manufacturerDispatch: {
          status: willDeadLetter ? "dead_letter" : "queued",
          queueId,
          retryAttempt: attempts + 1,
          retryMaxAttempts: maxAttempts,
          queueNextAttemptAt: nextAttemptAt,
          statusCode: result.statusCode || null,
          responseData: result.responseData || null,
          finishedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
        },
        status_integracao: willDeadLetter ? "fila_erro_fabricante" : "fila_reenvio_fabricante",
      });
    } catch (error) {
      const willDeadLetter = attempts + 1 >= maxAttempts;
      const nextAttemptAt = tsPlusMinutes(retryBackoffMinutes(attempts + 1));
      await after.ref.set({
        status: willDeadLetter ? "dead_letter" : "retrying",
        nextAttemptAt,
        finishedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
        lastError: error?.message || String(error),
        updatedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      await autoMergeOrderAndPedido(orderId, {
        manufacturerDispatch: {
          status: willDeadLetter ? "dead_letter" : "queued",
          queueId,
          retryAttempt: attempts + 1,
          retryMaxAttempts: maxAttempts,
          queueNextAttemptAt: nextAttemptAt,
          errorMessage: error?.message || String(error),
          finishedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
        },
        status_integracao: willDeadLetter ? "fila_erro_fabricante" : "fila_reenvio_fabricante",
      });
    }
  }
);


// ================= AUDITORIA ENTERPRISE =================
exports.auditManufacturerIntegrationChanges = onDocumentWritten(
  { document: "manufacturer_integrations/{manufacturer}" },
  async (event) => {
    const manufacturer = String(event.params?.manufacturer || "").trim() || null;
    const before = event.data?.before?.exists ? (event.data.before.data() || {}) : null;
    const after = event.data?.after?.exists ? (event.data.after.data() || {}) : null;
    const eventType = !before && after ? "integration_created" : before && !after ? "integration_deleted" : "integration_updated";
    await writeAuditLog({
      scope: "manufacturer_integration",
      eventType,
      manufacturer,
      integrationId: manufacturer,
      status: after ? "active" : "deleted",
      changedKeys: auditChangedKeys(before || {}, after || {}),
      metadata: { before, after },
    });
  }
);

exports.auditManufacturerQueueChanges = onDocumentWritten(
  { document: "manufacturer_dispatch_queue/{queueId}" },
  async (event) => {
    const queueId = String(event.params?.queueId || "").trim() || null;
    const before = event.data?.before?.exists ? (event.data.before.data() || {}) : null;
    const after = event.data?.after?.exists ? (event.data.after.data() || {}) : null;
    const row = after || before || {};
    const eventType = !before && after ? "queue_created" : before && !after ? "queue_deleted" : "queue_updated";
    await writeAuditLog({
      scope: "manufacturer_dispatch_queue",
      eventType,
      orderId: row.orderId || null,
      manufacturer: row.manufacturer || null,
      queueId,
      status: row.status || null,
      changedKeys: auditChangedKeys(before || {}, after || {}),
      metadata: { before, after },
    });
  }
);

exports.auditManufacturerOrderChanges = onDocumentWritten(
  { document: "orders/{orderId}" },
  async (event) => {
    const orderId = String(event.params?.orderId || "").trim() || null;
    const before = event.data?.before?.exists ? (event.data.before.data() || {}) : null;
    const after = event.data?.after?.exists ? (event.data.after.data() || {}) : null;
    if (!after) return;

    const beforeDispatch = before?.manufacturerDispatch || {};
    const afterDispatch = after?.manufacturerDispatch || {};
    const beforeIntegration = before?.status_integracao || null;
    const afterIntegration = after?.status_integracao || null;
    const beforeTracking = before?.tracking?.status || before?.status_entrega || null;
    const afterTracking = after?.tracking?.status || after?.status_entrega || null;

    const interesting = [];
    if (JSON.stringify(beforeDispatch) !== JSON.stringify(afterDispatch)) interesting.push("manufacturerDispatch");
    if (beforeIntegration != afterIntegration) interesting.push("status_integracao");
    if (beforeTracking != afterTracking) interesting.push("tracking.status");
    if (!interesting.length) return;

    await writeAuditLog({
      scope: "order_lifecycle",
      eventType: "order_integration_state_changed",
      orderId,
      manufacturer: after?.manufacturer || after?.fabricante || after?.vendedor_id || null,
      status: afterIntegration || afterDispatch?.status || null,
      changedKeys: interesting.concat(auditChangedKeys(beforeDispatch, afterDispatch).map((x) => `manufacturerDispatch.${x}`)).slice(0, 200),
      metadata: {
        before: { status_integracao: beforeIntegration, manufacturerDispatch: beforeDispatch, trackingStatus: beforeTracking },
        after: { status_integracao: afterIntegration, manufacturerDispatch: afterDispatch, trackingStatus: afterTracking },
      },
    });
  }
);


// ================= ALERTAS OPERACIONAIS =================
exports.alertOnManufacturerQueueChanges = onDocumentWritten(
  { document: "manufacturer_dispatch_queue/{queueId}" },
  async (event) => {
    const queueId = String(event.params?.queueId || "").trim() || null;
    const after = event.data?.after?.exists ? (event.data.after.data() || {}) : null;
    if (!after || !queueId) return;
    const status = String(after.status || "").toLowerCase();
    const attempts = Number(after.attempts || 0);
    if (status === "dead_letter") {
      await upsertOperationalAlert({
        type: "dispatch_dead_letter",
        severity: "critical",
        manufacturer: after.manufacturer || null,
        orderId: after.orderId || null,
        queueId,
        entityKey: queueId,
        title: "Pedido caiu em dead letter",
        message: `O pedido ${after.orderId || queueId} esgotou as tentativas de envio ao fabricante.`,
        metadata: after,
      });
    } else if (["pending", "retrying", "retry_processing"].includes(status) && attempts >= 3) {
      await upsertOperationalAlert({
        type: "dispatch_retry_pressure",
        severity: attempts >= 5 ? "high" : "medium",
        manufacturer: after.manufacturer || null,
        orderId: after.orderId || null,
        queueId,
        entityKey: queueId,
        title: "Fila de reenvio com muitas tentativas",
        message: `O pedido ${after.orderId || queueId} já acumula ${attempts} tentativas de envio ao fabricante.`,
        metadata: after,
      });
    } else {
      await resolveOperationalAlert("dispatch_dead_letter", queueId);
      await resolveOperationalAlert("dispatch_retry_pressure", queueId);
    }
  }
);

exports.alertOnManufacturerOrderChanges = onDocumentWritten(
  { document: "orders/{orderId}" },
  async (event) => {
    const orderId = String(event.params?.orderId || "").trim() || null;
    const after = event.data?.after?.exists ? (event.data.after.data() || {}) : null;
    if (!after || !orderId) return;
    const integ = String(after.status_integracao || "").toLowerCase();
    const dispatchStatus = String(after.manufacturerDispatch?.status || "").toLowerCase();
    const manufacturer = after.manufacturer || after.fabricante || after.vendedor_id || null;
    if (["erro_envio_fabricante", "fila_erro_fabricante"].includes(integ) || dispatchStatus === "error") {
      await upsertOperationalAlert({
        type: "order_dispatch_error",
        severity: "high",
        manufacturer,
        orderId,
        queueId: after.manufacturerDispatch?.queueId || null,
        entityKey: orderId,
        title: "Pedido com erro de integração",
        message: `O pedido ${orderId} está com falha no envio ao fabricante.`,
        metadata: {
          status_integracao: after.status_integracao || null,
          manufacturerDispatch: after.manufacturerDispatch || null,
        },
      });
    } else {
      await resolveOperationalAlert("order_dispatch_error", orderId);
    }
  }
);


const SLA_COLLECTION = "manufacturer_sla_breaches";
const SLA_DEFAULTS = {
  waiting: 6 * 60,
  queued: 2 * 60,
  retrying: 4 * 60,
  error: 60,
  dead_letter: 30,
  pending_antifraud: 12 * 60,
};

function normalizeManufacturerName(value) {
  return String(value || '').trim().toLowerCase() || null;
}

function normalizeSlaStatus(order = {}) {
  const md = order.manufacturerDispatch || {};
  const dispatchStatus = normalizeStatusLabel(md.status || '');
  const integ = normalizeStatusLabel(order.status_integracao || '');
  const antiFraud = normalizeStatusLabel(getByPath(order, 'antiFraud.status') || getByPath(order, 'orderIntegration.antiFraud.status') || '');

  if (dispatchStatus === 'dead_letter' || integ === 'fila_erro_fabricante') return 'dead_letter';
  if (dispatchStatus in { 'error':1, 'failed':1 } || integ === 'erro_envio_fabricante') return 'error';
  if (dispatchStatus in { 'retrying':1, 'retry_processing':1 } || integ === 'fila_reenvio_fabricante') return 'retrying';
  if (dispatchStatus === 'queued' || integ === 'aguardando_pre_requisitos') return antiFraud in { 'pendente':1, 'pending':1 } ? 'pending_antifraud' : 'queued';
  if (dispatchStatus === 'waiting') return antiFraud in { 'pendente':1, 'pending':1 } ? 'pending_antifraud' : 'waiting';
  if (!dispatchStatus || dispatchStatus === 'desconhecido') {
    if (integ === 'aguardando_pre_requisitos') return antiFraud in { 'pendente':1, 'pending':1 } ? 'pending_antifraud' : 'waiting';
  }
  return null;
}

function getSlaThresholdMinutes(status, order = {}) {
  const manufacturer = normalizeManufacturerName(order.manufacturer || order.fabricante || getByPath(order, 'integrationSnapshot.manufacturer'));
  const override = getByPath(order, `slaThresholds.${status}`) || getByPath(order, `orderIntegration.slaThresholds.${status}`);
  if (Number(override) > 0) return Number(override);
  if (manufacturer && ['samsung', 'apple', 'dell', 'hp', 'lenovo'].includes(manufacturer)) {
    const tuned = { waiting: 4 * 60, queued: 90, retrying: 3 * 60, error: 45, dead_letter: 15, pending_antifraud: 8 * 60 };
    return tuned[status] || SLA_DEFAULTS[status] || 120;
  }
  return SLA_DEFAULTS[status] || 120;
}

function getSlaReferenceMs(order = {}) {
  const md = order.manufacturerDispatch || {};
  return toMillis(md.startedAt) || toMillis(md.queueNextAttemptAt) || toMillis(order.updatedAt) || toMillis(order.createdAt);
}

function classifyEscalationLevel(delayMinutes, thresholdMinutes) {
  if (!Number.isFinite(delayMinutes) || !Number.isFinite(thresholdMinutes)) return 'warning';
  if (delayMinutes >= thresholdMinutes * 4) return 'critical';
  if (delayMinutes >= thresholdMinutes * 2) return 'high';
  return 'medium';
}

async function upsertSlaBreach(data = {}) {
  try {
    const orderId = String(data.orderId || '').trim();
    const statusKey = String(data.slaStatus || 'unknown').trim().toLowerCase();
    if (!orderId) return null;
    const breachId = `${sanitizeIdPart(orderId)}__${sanitizeIdPart(statusKey)}`;
    const ref = adminGlobal.firestore().collection(SLA_COLLECTION).doc(breachId);
    const now = adminGlobal.firestore.FieldValue.serverTimestamp();
    const existing = await ref.get();
    const current = existing.exists ? (existing.data() || {}) : {};
    const payload = {
      orderId,
      manufacturer: data.manufacturer || null,
      slaStatus: statusKey,
      severity: data.severity || 'medium',
      thresholdMinutes: Number(data.thresholdMinutes || 0) || null,
      ageMinutes: Number(data.ageMinutes || 0) || null,
      breachMinutes: Number(data.breachMinutes || 0) || null,
      status_integracao: data.status_integracao || null,
      dispatchStatus: data.dispatchStatus || null,
      open: data.open !== false,
      escalationLevel: data.escalationLevel || data.severity || 'medium',
      title: data.title || 'Violação de SLA de integração',
      message: data.message || null,
      metadata: auditRedact(data.metadata || null),
      buildId: BUILD_ID,
      updatedAt: now,
      lastSeenAt: now,
      resolvedAt: data.open === false ? now : null,
    };
    if (existing.exists) {
      payload.count = Number(current.count || 1) + 1;
      payload.createdAt = current.createdAt || now;
      payload.firstSeenAt = current.firstSeenAt || now;
    } else {
      payload.count = 1;
      payload.createdAt = now;
      payload.firstSeenAt = now;
    }
    await ref.set(payload, { merge: true });
    return { id: breachId, ...payload };
  } catch (error) {
    console.error('[sla] upsert breach failed:', error?.message || error);
    return null;
  }
}

async function resolveSlaBreach(orderId, slaStatus) {
  try {
    const breachId = `${sanitizeIdPart(orderId)}__${sanitizeIdPart(slaStatus)}`;
    await adminGlobal.firestore().collection(SLA_COLLECTION).doc(breachId).set({
      open: false,
      resolvedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
      updatedAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
      lastSeenAt: adminGlobal.firestore.FieldValue.serverTimestamp(),
      buildId: BUILD_ID,
    }, { merge: true });
  } catch (error) {
    console.error('[sla] resolve breach failed:', error?.message || error);
  }
}

async function evaluateOrderSla(orderId, order = {}) {
  const manufacturer = normalizeManufacturerName(order.manufacturer || order.fabricante || getByPath(order, 'integrationSnapshot.manufacturer'));
  const slaStatus = normalizeSlaStatus(order);
  const md = order.manufacturerDispatch || {};
  const dispatchStatus = normalizeStatusLabel(md.status || '');
  const integ = order.status_integracao || null;
  if (!slaStatus) {
    const possibleStatuses = ['waiting', 'queued', 'retrying', 'error', 'dead_letter', 'pending_antifraud'];
    await Promise.all(possibleStatuses.map((status) => resolveSlaBreach(orderId, status)));
    return null;
  }
  const referenceMs = getSlaReferenceMs(order);
  if (!referenceMs) return null;
  const ageMinutes = Math.max(0, Math.floor((Date.now() - referenceMs) / 60000));
  const thresholdMinutes = getSlaThresholdMinutes(slaStatus, order);
  const breachMinutes = Math.max(0, ageMinutes - thresholdMinutes);
  if (ageMinutes < thresholdMinutes) {
    await resolveSlaBreach(orderId, slaStatus);
    return null;
  }
  const severity = classifyEscalationLevel(ageMinutes, thresholdMinutes);
  const message = `O pedido ${orderId} ultrapassou o SLA de ${thresholdMinutes} min no estado ${slaStatus} e está há ${ageMinutes} min nessa condição.`;
  const payload = {
    orderId,
    manufacturer,
    slaStatus,
    severity,
    thresholdMinutes,
    ageMinutes,
    breachMinutes,
    escalationLevel: severity,
    status_integracao: integ,
    dispatchStatus,
    title: 'Violação de SLA de integração',
    message,
    metadata: {
      orderIntegrationReady: order.orderIntegrationReady === true,
      antiFraudStatus: getByPath(order, 'antiFraud.status') || getByPath(order, 'orderIntegration.antiFraud.status') || null,
      manufacturerDispatch: md || null,
    },
  };
  const saved = await upsertSlaBreach(payload);
  await upsertOperationalAlert({
    type: 'sla_breach',
    severity,
    manufacturer,
    orderId,
    queueId: md.queueId || null,
    entityKey: `${orderId}_${slaStatus}`,
    title: 'Violação de SLA',
    message,
    metadata: payload,
  });
  if (severity === 'critical' || severity === 'high') {
    await upsertOperationalAlert({
      type: 'sla_escalation',
      severity,
      manufacturer,
      orderId,
      queueId: md.queueId || null,
      entityKey: `${orderId}_${slaStatus}`,
      title: 'Escalonamento operacional automático',
      message: `O pedido ${orderId} entrou em escalonamento ${severity} por atraso de integração com o fabricante.`,
      metadata: payload,
    });
  } else {
    await resolveOperationalAlert('sla_escalation', `${orderId}_${slaStatus}`);
  }
  return saved;
}

async function buildSlaBreaches(db, filters = {}) {
  const manufacturer = pickManufacturerFilter(filters);
  const openRaw = String(filters.open || '').trim().toLowerCase();
  const onlyOpen = openRaw ? openRaw !== 'false' : true;
  const snap = await db.collection(SLA_COLLECTION).orderBy('updatedAt', 'desc').limit(300).get().catch(async () => db.collection(SLA_COLLECTION).limit(300).get());
  let items = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
  items = filterByManufacturer(items, manufacturer);
  if (onlyOpen) items = items.filter((item) => item.open !== false);
  return {
    manufacturer,
    onlyOpen,
    count: items.length,
    bySeverity: bucketBy(items, (x) => normalizeStatusLabel(x.severity)),
    bySlaStatus: bucketBy(items, (x) => normalizeStatusLabel(x.slaStatus)),
    items,
  };
}

async function buildSlaOverview(db, filters = {}) {
  const [breaches, health, alerts] = await Promise.all([
    buildSlaBreaches(db, filters),
    buildManufacturerHealth(db, filters),
    loadRecentAlertDocs(db, 250),
  ]);
  const openEscalations = filterByManufacturer(alerts, pickManufacturerFilter(filters))
    .filter((row) => ['sla_breach', 'sla_escalation'].includes(String(row.type || '').toLowerCase()) && row.status !== 'resolved');
  return {
    generatedAt: new Date().toISOString(),
    manufacturer: pickManufacturerFilter(filters),
    totals: {
      openBreaches: breaches.items.filter((x) => x.open !== false).length,
      criticalBreaches: breaches.items.filter((x) => normalizeStatusLabel(x.severity) === 'critical').length,
      highBreaches: breaches.items.filter((x) => normalizeStatusLabel(x.severity) === 'high').length,
      escalationsOpen: openEscalations.length,
      manufacturersCritical: (health.items || []).filter((x) => x.health === 'critical').length,
    },
    breaches: {
      count: breaches.count,
      bySeverity: breaches.bySeverity,
      bySlaStatus: breaches.bySlaStatus,
      items: breaches.items.slice(0, 100),
    },
    manufacturerHealth: health,
  };
}

async function scanSlaAndEscalations(db, filters = {}) {
  const manufacturer = pickManufacturerFilter(filters);
  const rows = filterByManufacturer(await loadRecentOrderDocs(db, 500), manufacturer);
  const findings = [];
  for (const row of rows) {
    const saved = await evaluateOrderSla(row.id, row);
    if (saved) findings.push(saved);
  }
  return findings;
}

exports.auditManufacturerSlaChanges = onDocumentWritten(
  { document: `${SLA_COLLECTION}/{breachId}` },
  async (event) => {
    const breachId = String(event.params?.breachId || '').trim() || null;
    const after = event.data?.after?.exists ? (event.data.after.data() || {}) : null;
    if (!breachId || !after) return;
    await writeAuditLog({
      scope: 'manufacturer_sla',
      eventType: after.open === false ? 'sla_breach_resolved' : 'sla_breach_upserted',
      status: 'success',
      orderId: after.orderId || null,
      manufacturer: after.manufacturer || null,
      metadata: { breachId, severity: after.severity || null, slaStatus: after.slaStatus || null },
      response: after,
    });
  }
);

exports.evaluateManufacturerSlaOnOrderChanges = onDocumentWritten(
  { document: 'orders/{orderId}' },
  async (event) => {
    const orderId = String(event.params?.orderId || '').trim() || null;
    const after = event.data?.after?.exists ? (event.data.after.data() || {}) : null;
    if (!orderId || !after) return;
    await evaluateOrderSla(orderId, after);
  }
);



// ===== Bootstrap Node local sem Firebase Functions =====
if (require.main === module && typeof exports.api === "function") {
  const http = require("http");
  const port = Number(process.env.PORT || 3000);
  http.createServer((req, res) => exports.api(req, res)).listen(port, () => {
    console.log("[compat] API Ariana Móveis rodando em http://localhost:" + port);
  });
}
