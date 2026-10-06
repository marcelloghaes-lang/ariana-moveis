import express from 'express';

const app = express();
const port = Number(process.env.PORT || 10000);
const payload = {
  ok: true,
  disabled: true,
  service: 'ariana-dslite-beto-shadow',
  message: 'Integração DSLite/Beto removida do sistema da Ariana Móveis.'
};

app.get('/', (_req, res) => res.json(payload));
app.get('/health', (_req, res) => res.json(payload));
app.get('/report', (_req, res) => res.json(payload));

app.listen(port, '0.0.0.0', () => {
  console.log(`[ARIANA-DSLITE-DISABLED] listening ${port}`);
});
