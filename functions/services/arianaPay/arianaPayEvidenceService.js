// Ariana Pay — pacote de evidências para contestação/chargeback.
// Apenas organiza evidências já existentes no pedido. Não expõe PAN/CVV/token/secrets.

function clean(value=''){
  return String(value||'').trim();
}

function digits(value=''){
  return clean(value).replace(/\D/g,'');
}

function maskDocument(value=''){
  const d=digits(value);
  if(d.length<=4) return d?'***'+d:'';
  return '*'.repeat(Math.max(0,d.length-4))+d.slice(-4);
}

function redactPayment(payment={}){
  return {
    provider:clean(payment.provider),
    method:clean(payment.method||payment.type),
    paymentId:clean(payment.paymentId||payment.id),
    status:clean(payment.status),
    statusDetail:clean(payment.statusDetail),
    installments:Number(payment.installments||1)||1,
    liveMode:payment.liveMode===true,
    transactionSecurity:payment.transactionSecurity||payment.transaction_security||payment.raw?.transaction_security||payment.raw?.payment_method?.transaction_security||null
  };
}

export function buildChargebackEvidencePacket(order={}){
  const shipping=order.shipping&&typeof order.shipping==='object'?order.shipping:{};
  const address=order.shippingAddress&&typeof order.shippingAddress==='object'?order.shippingAddress:{};
  const tracking=Array.isArray(order.trackingHistory)?order.trackingHistory:[];

  const invoices=[
    order.nfe,
    order.notaFiscal,
    order.fiscal,
    ...(Array.isArray(order.sellerInvoices)?order.sellerInvoices:[]),
    ...(Array.isArray(order.enterpriseInvoices)?order.enterpriseInvoices:[])
  ].filter(Boolean);

  return {
    version:1,
    generatedFrom:'order_snapshot',
    order:{
      id:clean(order._id||order.id||order.orderId),
      createdAt:order.createdAt||null,
      status:clean(order.status),
      statusLabel:clean(order.statusLabel),
      total:Number(order.total||0)||0,
      currency:clean(order.currency||'BRL')
    },
    customer:{
      name:clean(order.customerName),
      email:clean(order.customerEmail),
      phone:digits(order.customerPhone),
      documentMasked:maskDocument(order.customerCpf)
    },
    shippingAddress:{
      cep:digits(address.cep||address.zipCode||address.zip_code),
      city:clean(address.cidade||address.city),
      uf:clean(address.uf||address.state),
      street:clean(address.logradouro||address.street||address.street_name),
      number:clean(address.numero||address.number||address.street_number),
      neighborhood:clean(address.bairro||address.neighborhood)
    },
    items:(Array.isArray(order.items)?order.items:[]).map(item=>({
      productId:clean(item.productId),
      sku:clean(item.sku),
      name:clean(item.name),
      qty:Number(item.qty||item.quantity||1)||1,
      unitPrice:Number(item.unitPrice||0)||0,
      totalPrice:Number(item.totalPrice||0)||0,
      sellerId:clean(item.sellerId)
    })),
    payment:redactPayment(order.payment||{}),
    delivery:{
      trackingCode:clean(order.trackingCode||shipping.trackingCode),
      carrier:clean(shipping.carrier||shipping.provider||shipping.transportadora),
      deliveredAt:shipping.deliveredAt||order.deliveredAt||null,
      trackingHistory:tracking.map(event=>({
        status:clean(event.status||event.statusLabel||event.title),
        description:clean(event.description||event.message),
        date:event.occurredAt||event.eventAt||event.dateTime||event.datetime||event.dataHora||event.date||event.createdAt||event.updatedAt||null
      }))
    },
    fiscalEvidence:invoices.map(invoice=>({
      accessKey:clean(invoice.accessKey||invoice.chaveAcesso||invoice.chave||invoice.key),
      number:clean(invoice.number||invoice.numero||invoice.nfeNumber),
      series:clean(invoice.series||invoice.serie),
      status:clean(invoice.status),
      xmlUrl:clean(invoice.xmlUrl||invoice.xml_url),
      pdfUrl:clean(invoice.pdfUrl||invoice.danfeUrl||invoice.pdf_url)
    })),
    notes:clean(order.notes),
    privacy:{
      panStored:false,
      cvvStored:false,
      cardTokenIncluded:false,
      fullCustomerDocumentIncluded:false
    }
  };
}

export function evidenceCompleteness(packet={}){
  const missing=[];
  if(!packet.order?.id) missing.push('order_id');
  if(!packet.payment?.paymentId) missing.push('payment_id');
  if(!packet.customer?.name) missing.push('customer_name');
  if(!packet.customer?.email) missing.push('customer_email');
  if(!packet.shippingAddress?.cep) missing.push('shipping_cep');
  if(!packet.delivery?.trackingCode) missing.push('tracking_code');
  if(!packet.delivery?.deliveredAt && !(packet.delivery?.trackingHistory||[]).some(e=>String(e.status||'').toLowerCase().includes('entreg'))) {
    missing.push('delivery_proof');
  }
  if(!(packet.fiscalEvidence||[]).some(row=>row.accessKey||row.number)) missing.push('fiscal_document');

  return {
    complete:missing.length===0,
    score:Math.max(0,100-(missing.length*14)),
    missing
  };
}

export default {
  buildChargebackEvidencePacket,
  evidenceCompleteness
};
