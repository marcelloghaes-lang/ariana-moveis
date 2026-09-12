import https from 'node:https';
import axios from 'axios';

const SOAP12_NS='http://www.w3.org/2003/05/soap-envelope';

function snippet(value=''){
  return String(value||'').replace(/\s+/g,' ').trim().slice(0,220);
}

function normalizeSoapResponse(xml=''){
  const source=String(xml||'').replace(/^\uFEFF/,'').trim();
  if(!source)throw new Error('SEFAZ/MG respondeu sem conteúdo.');
  if(/<(?:soap12|soapenv|soap):Body\b/i.test(source))return source;
  const body=source.match(/<(?:[A-Za-z_][\w.-]*:)?Body\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?Body>/i);
  if(body)return `<soap:Envelope xmlns:soap="${SOAP12_NS}"><soap:Body>${body[1]}</soap:Body></soap:Envelope>`;
  if(/<retEnviNFe\b/i.test(source))return `<soap:Envelope xmlns:soap="${SOAP12_NS}"><soap:Body>${source}</soap:Body></soap:Envelope>`;
  throw new Error(`Resposta inesperada da SEFAZ/MG: ${snippet(source)}`);
}

export function createErpSefazTransport(){
  return{
    async send(req={}){
      const agent=new https.Agent({pfx:req.pfx,passphrase:req.password,minVersion:'TLSv1.2',rejectUnauthorized:true});
      const action=String(req.soapAction||'');
      const response=await axios.post(req.url,req.xml,{
        httpsAgent:agent,
        headers:{
          'Content-Type':`application/soap+xml; charset=utf-8${action?`; action="${action}"`:''}`,
          ...(action?{'SOAPAction':`"${action}"`}:{})
        },
        timeout:30000,
        maxRedirects:0,
        responseType:'text',
        transformResponse:[data=>data],
        validateStatus:()=>true
      });
      const raw=String(response.data||'');
      if(response.status<200||response.status>=300)throw new Error(`SEFAZ/MG respondeu HTTP ${response.status}: ${snippet(raw)}`);
      return{xml:normalizeSoapResponse(raw),statusCode:response.status};
    }
  };
}

export default createErpSefazTransport;
