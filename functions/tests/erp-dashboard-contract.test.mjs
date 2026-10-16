import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard=fs.readFileSync(new URL('../../public/erp_ariana.html',import.meta.url),'utf8');
const reports=fs.readFileSync(new URL('../../public/erp_relatorios.html',import.meta.url),'utf8');

test('dashboard usa faturamento histórico completo, não apenas o ano corrente',()=>{
  assert.match(dashboard,/allStart=new Date\(2000,0,1\)/);
  assert.match(dashboard,/salesSummary\(allStart,now,\{onlyBilled:true\}\)/);
  assert.match(dashboard,/renderRanking\(salesAll\.customerRanking\|\|\[\]\)/);
  assert.match(dashboard,/allTotal=Number\(salesAll\.summary\?\.total\|\|0\)/);
  assert.match(dashboard,/Faturamento total no ERP/);
});

test('dashboard não usa marcadores azuis flutuantes no saldo previsto',()=>{
  assert.doesNotMatch(dashboard,/cy="\$\{y\(r\.balance\)\}"[^>]*fill="#1677ff"/);
  assert.match(dashboard,/cy="\$\{h-30\}"[^>]*fill="#20bf55"/);
});

test('relatório aberto pelo ranking preserva período e filtro de faturadas',()=>{
  assert.match(dashboard,/from=2000-01-01&to=\$\{dateOnly\(now\)\}&onlyBilled=true/);
  assert.match(reports,/p\.set\('onlyBilled','true'\)/);
  assert.match(reports,/queryFrom=qs\.get\('from'\)/);
  assert.match(reports,/queryTo=qs\.get\('to'\)/);
});
