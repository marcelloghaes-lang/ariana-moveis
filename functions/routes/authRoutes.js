export default function registerAuthRoutes(app, controller, { authRequired }) {
  app.get('/api/auth/google-config', controller.googleConfig);
  app.post('/api/auth/google-login', controller.googleLogin);
  app.post('/api/auth/forgot-password', controller.forgotPassword);
  app.post('/api/auth/reset-password', controller.resetPassword);
  app.post('/api/auth/change-password', authRequired, controller.changePassword);
  app.post('/api/auth/register', controller.register);
  app.post('/api/auth/login', controller.login);
}
