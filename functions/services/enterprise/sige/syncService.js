import { SigeClient } from './client.js';
import { buildSigePedidoPayload, extractInvoiceFromSige } from './mapper.js';

async function safeLog(models, payload = {}) {
  try {
    if (!models?.IntegrationAuditLog) return null;
    return await models.IntegrationAuditLog.create({
      scope: 'sige',
      eventType: payload.eventType || 'sige.event',
      orderId: payload.orderId || null,
      manufacturer: 'SIGE Cloud',
      integrationId: 'sige_cloud',
      status: payload.status || 'success',
      statusCode: payload.statusCode || null,
      message: payload.message || '',
      request: payload.request || null,
      response: payload.response || null,
      metadata: payload.metadata || null
    });
  } catch (error) {
    console.error('[SIGE audit log] erro:', error.message || error);
    return null;
  }
}

export class SigeSyncService {
  constructor(models = {}, config = {}) {
    this.models = models;
    this.client = new SigeClient(config);
  }

  async getOrder(orderId) {
    const Order = this.models.Order;
    if (!Order) throw new Error('Model Order não injetado no módulo SIGE');
    const query = String(orderId || '').match(/^[a-f0-9]{24}$/i)
      ? { _id: orderId }
      : { $or: [{ orderId: String(orderId) }, { 'payment.externalReference': String(orderId) }] };
    const order = await Order.findOne(query);
    if (!order) {
      const error = new Error('Pedido não encontrado');
      error.statusCode = 404;
      throw error;
    }
    return order;
  }

  async criarVenda(orderId, options = {}) {
    const order = await this.getOrder(orderId);
    const payload = buildSigePedidoPayload(order.toObject ? order.toObject() : order, options);
    const result = options.faturar === false
      ? await this.client.salvarPedido(payload, { retornarPedido: true })
      : await this.client.salvarEFaturar(payload, { retornarPedido: true });

    order.sige = {
      ...(order.sige || {}),
      synced: true,
      lastSyncAt: new Date(),
      endpoint: options.faturar === false ? '/request/Pedidos/Salvar' : '/request/Pedidos/SalvarEFaturar',
      codigoPedidoCliente: payload.CodigoPedidoCliente,
      codigo: payload.Codigo,
      response: result.data
    };
    order.status_integracao = 'sige_venda_criada';
    await order.save();

    await safeLog(this.models, {
      eventType: 'sige.order.synced',
      orderId: String(order._id),
      status: 'success',
      statusCode: result.status,
      request: payload,
      response: result.data,
      metadata: { elapsedMs: result.elapsedMs }
    });

    return { order, payload, sige: result };
  }

  async consultarPedidoSige(orderId) {
    const order = await this.getOrder(orderId);
    const orderObject = order.toObject ? order.toObject() : order;
    const codigoPedidoCliente = orderObject.sige?.codigoPedidoCliente || String(orderObject._id || orderObject.id || '');
    const result = await this.client.pesquisarPedidos({ codigoPedidoCliente });
    await safeLog(this.models, {
      eventType: 'sige.order.search',
      orderId: String(order._id),
      status: 'success',
      statusCode: result.status,
      response: result.data,
      metadata: { codigoPedidoCliente }
    });
    return { order, sige: result };
  }

  async sincronizarNfe(orderId) {
    const { order, sige } = await this.consultarPedidoSige(orderId);
    const invoice = extractInvoiceFromSige(sige.data);
    order.invoice = { ...(order.invoice || {}), ...invoice, syncedFrom: 'sige', syncedAt: new Date() };
    order.sige = { ...(order.sige || {}), invoice, lastInvoiceSyncAt: new Date() };
    if (invoice.number || invoice.accessKey) order.status_integracao = 'sige_nfe_sincronizada';
    await order.save();

    if (this.models.EnterpriseBillingRecord && (invoice.number || invoice.accessKey)) {
      await this.models.EnterpriseBillingRecord.findOneAndUpdate(
        { orderId: String(order._id) },
        {
          $set: {
            orderId: String(order._id),
            orderObjectId: order._id,
            manufacturer: 'SIGE Cloud',
            status: invoice.status || 'synced',
            invoiceNumber: invoice.number,
            serie: invoice.serie,
            invoiceKey: invoice.accessKey,
            xmlUrl: invoice.xmlUrl,
            danfeUrl: invoice.danfeUrl,
            protocol: invoice.protocol,
            payload: invoice.raw
          },
          $push: { history: { at: new Date(), action: 'sige_invoice_synced', invoice } }
        },
        { upsert: true, new: true }
      );
    }

    await safeLog(this.models, {
      eventType: 'sige.invoice.synced',
      orderId: String(order._id),
      status: invoice.number || invoice.accessKey ? 'success' : 'pending',
      statusCode: sige.status,
      response: invoice
    });

    return { order, invoice, raw: sige.data };
  }
}
