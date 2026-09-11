import express from 'express';
import multer from 'multer';
import { createErpSigeMigrationService } from '../../services/erp/erpSigeMigrationService.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 16 * 1024 * 1024 }
});

export default function createErpSigeMigrationRoutes(context = {}) {
  const router = express.Router();
  if (!context.adminRequired) throw new Error('[erp-sige-migration] adminRequired não informado');
  const migration = createErpSigeMigrationService(context);

  router.get('/erp/migracao/sige/status', context.adminRequired, (_req, res) => {
    return res.json({
      ok: true,
      mode: 'dry-run',
      writesEnabled: false,
      accepted: ['.zip'],
      maxUploadMb: 16,
      message: 'A migração SIGE está em modo de simulação. Nenhum cadastro, produto, estoque, financeiro, venda ou nota fiscal é gravado.'
    });
  });

  router.post('/erp/migracao/sige/dry-run', context.adminRequired, upload.single('package'), async (req, res) => {
    try {
      const report = await migration.dryRun(req.file || null);
      return res.json({ ok: true, report });
    } catch (error) {
      console.error('[erp-sige-migration/dry-run]', error?.code || '', error?.message || error);
      return res.status(Number(error?.statusCode || 500)).json({
        ok: false,
        error: error?.message || 'Erro ao analisar o pacote do SIGE.',
        code: error?.code || 'ERP_SIGE_MIGRATION_ERROR'
      });
    }
  });

  router.use((error, _req, res, next) => {
    if (!(error instanceof multer.MulterError)) return next(error);
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({
      ok: false,
      error: error.code === 'LIMIT_FILE_SIZE' ? 'O ZIP excede o limite seguro de 16 MB.' : 'Falha ao receber o pacote do SIGE.',
      code: `SIGE_UPLOAD_${error.code || 'ERROR'}`
    });
  });

  return router;
}
