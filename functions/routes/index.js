import manufacturerIntegrationRoutes from './manufacturerIntegrationRoutes.js';
import createSigeRoutes from './sige/index.js';
import createTelevendasRoutes from './televendas/index.js';
import { createHealthController } from '../controllers/healthController.js';
import { createAuthController } from '../controllers/authController.js';
import { createUserController } from '../controllers/userController.js';
import registerHealthRoutes from './healthRoutes.js';
import registerAuthRoutes from './authRoutes.js';
import registerUserRoutes from './userRoutes.js';

/**
 * Centraliza o carregamento das rotas já modularizadas.
 * Mantém os mesmos endpoints e recebe as dependências do server.js.
 */
export function registerModularRoutes(app, deps = {}) {
  const healthController = createHealthController({ BUILD_ID: deps.BUILD_ID });
  registerHealthRoutes(app, healthController);

  const authController = createAuthController({
    User: deps.User,
    Seller: deps.Seller,
    GOOGLE_CLIENT_ID: deps.GOOGLE_CLIENT_ID,
    googleClient: deps.googleClient,
    EMAIL_HOST: deps.EMAIL_HOST,
    EMAIL_PORT: deps.EMAIL_PORT,
    EMAIL_SECURE: deps.EMAIL_SECURE,
    EMAIL_USER: deps.EMAIL_USER,
    EMAIL_PASS: deps.EMAIL_PASS,
    EMAIL_FROM: deps.EMAIL_FROM,
    RESET_PASSWORD_URL: deps.RESET_PASSWORD_URL,
    FRONTEND_URL: deps.FRONTEND_URL,
    signToken: deps.signToken,
    uid: deps.uid,
    toJSON: deps.toJSON,
    changedKeys: deps.changedKeys,
    writeAuditLog: deps.writeAuditLog
  });
  registerAuthRoutes(app, authController, { authRequired: deps.authRequired });

  const userController = createUserController({
    User: deps.User,
    toJSON: deps.toJSON,
    changedKeys: deps.changedKeys,
    writeAuditLog: deps.writeAuditLog
  });
  registerUserRoutes(app, userController, { authRequired: deps.authRequired });
}

/**
 * Centraliza o carregamento dos módulos externos que já existiam separados.
 */
export function registerExternalIntegrationRoutes(app, deps = {}) {
  app.use('/api', createSigeRoutes({
    adminRequired: deps.adminRequired,
    Order: deps.Order,
    Product: deps.Product,
    User: deps.User,
    Setting: deps.Setting,
    IntegrationAuditLog: deps.IntegrationAuditLog,
    EnterpriseBillingRecord: deps.EnterpriseBillingRecord,
    redact: deps.redact
  }));

  app.use('/api', createTelevendasRoutes({
    Order: deps.Order,
    Product: deps.Product,
    User: deps.User,
    PaymentEvent: deps.PaymentEvent,
    IntegrationAuditLog: deps.IntegrationAuditLog,
    Notification: deps.Notification,
    EnterpriseBillingRecord: deps.EnterpriseBillingRecord,
    adminRequired: deps.adminRequired,
    authRequired: deps.authRequired,
    axios: deps.axios,
    crypto: deps.crypto,
    toJSON: deps.toJSON,
    redact: deps.redact,
    createAdminNotification: deps.createAdminNotification,
    createSellerOrderNotifications: deps.createSellerOrderNotifications,
    FRONTEND_URL: deps.FRONTEND_URL,
    onTelevendasPaymentApproved: deps.onTelevendasPaymentApproved
  }));

  app.use('/api/enterprise', manufacturerIntegrationRoutes);
}
