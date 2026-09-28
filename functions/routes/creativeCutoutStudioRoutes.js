import {
  createCreativeCutoutAsset,
  listCreativeCutoutAssets,
  getCreativeCutoutAsset,
  reprocessCreativeCutoutAsset,
  approveCreativeCutoutAsset,
  rejectCreativeCutoutAsset,
  deleteCreativeCutoutAsset,
  updateCreativeCutoutAssetMetadata,
  getCreativeCutoutFile,
  creativeCutoutSummary
} from '../services/creativeCutoutBankService.js';

export default function registerCreativeCutoutStudioRoutes(app, context = {}) {
  const {
    mongoose,
    adminRequired,
    upload,
    fs
  } = context;

  if (!mongoose || !adminRequired || !upload || !fs) {
    console.warn('[creative-cutout-studio] contexto incompleto; rotas não registradas.');
    return;
  }

  app.get('/api/admin/creative-cutout-studio/summary', adminRequired, async (_req, res) => {
    try {
      return res.json({
        ok: true,
        summary: await creativeCutoutSummary({ mongoose })
      });
    } catch (error) {
      console.error('[creative-cutout-studio] summary:', error);
      return res.status(500).json({ ok: false, error: error.message || 'Falha ao carregar resumo.' });
    }
  });

  app.get('/api/admin/creative-cutout-studio/assets', adminRequired, async (req, res) => {
    try {
      const assets = await listCreativeCutoutAssets({
        mongoose,
        status: String(req.query?.status || ''),
        limit: Number(req.query?.limit || 60)
      });
      return res.json({ ok: true, assets });
    } catch (error) {
      console.error('[creative-cutout-studio] list:', error);
      return res.status(500).json({ ok: false, error: error.message || 'Falha ao carregar o Banco Mestre.' });
    }
  });

  app.post(
    '/api/admin/creative-cutout-studio/assets',
    adminRequired,
    upload.single('file'),
    async (req, res) => {
      let filePath = '';
      try {
        if (!req.file) {
          return res.status(400).json({ ok: false, error: 'Selecione uma imagem original.' });
        }

        filePath = String(req.file.path || '');
        const mimeType = String(req.file.mimetype || '').toLowerCase();
        if (!mimeType.startsWith('image/')) {
          return res.status(415).json({ ok: false, error: 'O arquivo enviado não é uma imagem válida.' });
        }

        const originalBuffer = await fs.promises.readFile(filePath);
        const asset = await createCreativeCutoutAsset({
          mongoose,
          originalBuffer,
          originalName: req.file.originalname || 'produto',
          mimeType,
          name: req.body?.name || req.file.originalname || 'Produto',
          category: req.body?.category || '',
          sku: req.body?.sku || '',
          notes: req.body?.notes || ''
        });

        return res.status(201).json({ ok: true, asset });
      } catch (error) {
        console.error('[creative-cutout-studio] upload/process:', error);
        return res.status(500).json({
          ok: false,
          error: error.message || 'Não foi possível criar o recorte.'
        });
      } finally {
        if (filePath && fs.existsSync(filePath)) {
          try { fs.unlinkSync(filePath); } catch {}
        }
      }
    }
  );

  app.get('/api/admin/creative-cutout-studio/assets/:id', adminRequired, async (req, res) => {
    try {
      const asset = await getCreativeCutoutAsset({ mongoose, id: req.params.id });
      if (!asset) return res.status(404).json({ ok: false, error: 'Imagem não encontrada.' });
      return res.json({ ok: true, asset });
    } catch (error) {
      console.error('[creative-cutout-studio] detail:', error);
      return res.status(500).json({ ok: false, error: error.message || 'Falha ao carregar a imagem.' });
    }
  });

  app.patch('/api/admin/creative-cutout-studio/assets/:id', adminRequired, async (req, res) => {
    try {
      const asset = await updateCreativeCutoutAssetMetadata({
        mongoose,
        id: req.params.id,
        name: req.body?.name,
        category: req.body?.category,
        sku: req.body?.sku,
        notes: req.body?.notes
      });
      if (!asset) return res.status(404).json({ ok: false, error: 'Imagem não encontrada.' });
      return res.json({ ok: true, asset });
    } catch (error) {
      console.error('[creative-cutout-studio] metadata:', error);
      return res.status(500).json({ ok: false, error: error.message || 'Falha ao atualizar dados.' });
    }
  });

  app.post('/api/admin/creative-cutout-studio/assets/:id/reprocess', adminRequired, async (req, res) => {
    try {
      const mode = String(req.body?.mode || 'standard') === 'ai_repair'
        ? 'ai_repair'
        : 'standard';
      const asset = await reprocessCreativeCutoutAsset({
        mongoose,
        id: req.params.id,
        mode
      });
      if (!asset) return res.status(404).json({ ok: false, error: 'Imagem não encontrada.' });
      return res.json({ ok: true, asset });
    } catch (error) {
      console.error('[creative-cutout-studio] reprocess:', error);
      if (error?.code === 'creative_cutout_ai_repair_rejected') {
        return res.status(422).json({
          ok: false,
          code: error.code,
          reason: error.aiReason || 'ai_master_repair_rejected',
          error: 'A IA não conseguiu gerar uma reconstrução fiel o suficiente. O recorte anterior foi mantido sem alterações.'
        });
      }
      if (error?.code === 'creative_cutout_already_processing') {
        return res.status(409).json({
          ok: false,
          code: error.code,
          processing: error.processing || null,
          error: 'Este produto já está sendo processado. Aguarde a conclusão antes de iniciar novamente.'
        });
      }
      return res.status(500).json({
        ok: false,
        error: error.message || 'Falha ao reprocessar a imagem.'
      });
    }
  });

  app.post('/api/admin/creative-cutout-studio/assets/:id/approve', adminRequired, async (req, res) => {
    try {
      const asset = await approveCreativeCutoutAsset({ mongoose, id: req.params.id });
      if (!asset) return res.status(404).json({ ok: false, error: 'Recorte não encontrado.' });
      return res.json({ ok: true, asset });
    } catch (error) {
      console.error('[creative-cutout-studio] approve:', error);
      return res.status(500).json({ ok: false, error: error.message || 'Falha ao aprovar o recorte.' });
    }
  });

  app.post('/api/admin/creative-cutout-studio/assets/:id/reject', adminRequired, async (req, res) => {
    try {
      const asset = await rejectCreativeCutoutAsset({ mongoose, id: req.params.id });
      if (!asset) return res.status(404).json({ ok: false, error: 'Recorte não encontrado.' });
      return res.json({ ok: true, asset });
    } catch (error) {
      console.error('[creative-cutout-studio] reject:', error);
      return res.status(500).json({ ok: false, error: error.message || 'Falha ao rejeitar o recorte.' });
    }
  });

  app.get(
    '/api/admin/creative-cutout-studio/assets/:id/:kind(original|cutout|approved)',
    adminRequired,
    async (req, res) => {
      try {
        const file = await getCreativeCutoutFile({
          mongoose,
          id: req.params.id,
          kind: req.params.kind
        });
        if (!file) return res.status(404).json({ ok: false, error: 'Arquivo não encontrado.' });

        const download = String(req.query?.download || '') === '1';
        res.setHeader('Content-Type', file.contentType || 'application/octet-stream');
        res.setHeader('Cache-Control', 'private, max-age=60');
        res.setHeader(
          'Content-Disposition',
          (download ? 'attachment' : 'inline') + '; filename="' +
            String(file.filename || 'imagem.png').replace(/"/g, '') +
            '"'
        );
        return res.send(file.buffer);
      } catch (error) {
        console.error('[creative-cutout-studio] file:', error);
        return res.status(500).json({ ok: false, error: error.message || 'Falha ao carregar arquivo.' });
      }
    }
  );

  app.delete('/api/admin/creative-cutout-studio/assets/:id', adminRequired, async (req, res) => {
    try {
      const deleted = await deleteCreativeCutoutAsset({ mongoose, id: req.params.id });
      if (!deleted) return res.status(404).json({ ok: false, error: 'Imagem não encontrada.' });
      return res.json({ ok: true });
    } catch (error) {
      console.error('[creative-cutout-studio] delete:', error);
      return res.status(500).json({ ok: false, error: error.message || 'Falha ao excluir imagem.' });
    }
  });
}
