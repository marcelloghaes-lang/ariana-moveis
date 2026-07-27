export default function registerHealthRoutes(app, controller) {
  app.get('/', controller.root);
  app.get('/health', controller.health);
  app.get('/api/health', controller.apiHealth);
}
