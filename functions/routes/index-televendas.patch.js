// No topo do arquivo central de rotas:
import createTelevendasRoutes from './televendas/index.js';

// Dentro de registerExternalIntegrationRoutes(app, deps = {}):
app.use('/api', createTelevendasRoutes({
  Order: deps.Order,
  Product: deps.Product,
  User: deps.User,
  IntegrationAuditLog: deps.IntegrationAuditLog,
  Notification: deps.Notification,
  adminRequired: deps.adminRequired,
  authRequired: deps.authRequired,
  crypto: deps.crypto,
  toJSON: deps.toJSON,
  redact: deps.redact,
  createAdminNotification: deps.createAdminNotification,
  createSellerOrderNotifications: deps.createSellerOrderNotifications,
  FRONTEND_URL: deps.FRONTEND_URL
}));
