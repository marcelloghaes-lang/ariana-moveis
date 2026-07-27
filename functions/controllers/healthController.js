import mongoose from 'mongoose';

export function createHealthController({ BUILD_ID }) {
  function root(_req, res) {
    return res.json({
      ok: true,
      service: 'Ariana Móveis Enterprise Mongo API',
      buildId: BUILD_ID
    });
  }

  function health(_req, res) {
    return res.json({
      ok: true,
      mongo: mongoose.connection.readyState === 1 ? 'connected' : `state_${mongoose.connection.readyState}`,
      buildId: BUILD_ID,
      uptime: process.uptime(),
      time: new Date().toISOString()
    });
  }

  function apiHealth(_req, res) {
    return res.json({
      ok: true,
      status: 'online',
      service: 'ariana-backend',
      time: new Date().toISOString()
    });
  }

  return { root, health, apiHealth };
}
