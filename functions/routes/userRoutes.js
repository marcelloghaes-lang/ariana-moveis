export default function registerUserRoutes(app, controller, { authRequired }) {
  app.get('/api/me', authRequired, controller.me);
  app.patch('/api/users/me', authRequired, controller.updateMe);
}
