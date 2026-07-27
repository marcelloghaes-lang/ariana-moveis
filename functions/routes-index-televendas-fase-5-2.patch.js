// No objeto enviado para createTelevendasRoutes, acrescente:

app.use('/api', createTelevendasRoutes({
  Order: deps.Order,
  Product: deps.Product,
  User: deps.User,
  PaymentEvent: deps.PaymentEvent,
  IntegrationAuditLog: deps.IntegrationAuditLog,
  Notification: deps.Notification,
  adminRequired: deps.adminRequired,
  authRequired: deps.authRequired,
  axios: deps.axios,
  crypto: deps.crypto,
  toJSON: deps.toJSON,
  redact: deps.redact,
  createAdminNotification: deps.createAdminNotification,
  createSellerOrderNotifications: deps.createSellerOrderNotifications,
  onTelevendasPaymentApproved: deps.onTelevendasPaymentApproved,
  FRONTEND_URL: deps.FRONTEND_URL
}));
