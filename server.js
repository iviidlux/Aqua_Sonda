// server.js - Servidor principal simplificado
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const os = require('os');

// Configuración
const { PORT } = require('./config/constants');
const pool = require('./config/database');

// Middleware
const logger = require('./middleware/logger');

// Rutas
const authRoutes = require('./routes/auth');
const instalacionesRoutes = require('./routes/instalaciones');
const sensoresRoutes = require('./routes/sensores');
const umbralesRoutes = require('./routes/umbrales');
const alertasRoutes = require('./routes/alertas');
const tareasRoutes = require('./routes/tareas');
const lecturasRoutes = require('./routes/lecturas');

// Inicializar app
const app = express();

// Middleware global
app.use(cors());
app.use(express.json());
app.use(logger);

// ===== RUTAS =====

// Health check
app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'aquasense-api',
    version: '2.0',
    endpoints: [
      'GET /debug/db-ping',
      'POST /auth/register, /api/auth/register',
      'POST /auth/login, /api/auth/login',
      'POST /auth/change-password, /api/auth/change-password',
      'GET /api/instalaciones',
      'DELETE /api/instalaciones/:id',
      'GET /api/instalaciones/:id/sensores',
      'GET /api/sensores/catalogo',
      'POST /api/sensores/catalogo',
      'GET /api/sensores/instalacion/:id',
      'POST /api/sensores/instalacion/:id',
      'DELETE /api/sensores/instalados/:id',
      'GET /api/sensores/:id/lecturas',
      'POST /api/sensores/:id/lecturas',
      'PUT /api/sensores/instalados/:id/estado',
      'GET /api/sensores/:id/alertas',
      'GET /api/umbrales/sensor/:id',
      'POST /api/umbrales/sensor/:id',
      'PUT /api/umbrales/:id',
      'DELETE /api/umbrales/:id',
      'PUT /api/umbrales/:id/estado',
      'GET /api/umbrales/instalacion/:id',
      'GET /api/umbrales/predeterminados/:tipo',
      'GET /api/alertas/instalacion/:id',
      'PUT /api/alertas/:id/leer',
      'PUT /api/alertas/:id/resolver',
      'PUT /api/alertas/instalacion/:id/leer-todas',
      'GET /api/alertas/instalacion/:id/count',
      'POST /api/alertas',
      'DELETE /api/alertas/:id',
      'GET /api/alertas/instalacion/:id/estadisticas',
      'GET /api/tareas-programadas/:idInstalacion',
      'POST /api/tareas-programadas',
      'PUT /api/tareas-programadas/:id',
      'DELETE /api/tareas-programadas/:id',
      'GET /api/lecturas/resumen',
    ],
  });
});

// Debug: Ping base de datos
app.get('/debug/db-ping', async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 AS ok');
    res.json({ ok: rows[0].ok, db: process.env.DB_NAME || 'u889902058_sonda0109_local' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Debug: whoami (información del servidor)
app.get('/whoami', (_req, res) => {
  const nets = os.networkInterfaces();
  let lanIP = '127.0.0.1';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        lanIP = net.address;
      }
    }
  }
  res.json({
    file: __filename,
    cwd: process.cwd(),
    lan: lanIP,
    time: new Date().toISOString(),
  });
});

// Montar rutas modulares
app.use('/auth', authRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/instalaciones', instalacionesRoutes);
app.use('/api/sensores', sensoresRoutes);
app.use('/api/umbrales', umbralesRoutes);
app.use('/api/alertas', alertasRoutes);
app.use('/api/tareas-programadas', tareasRoutes);
app.use('/api/lecturas', lecturasRoutes);

// 404 handler
app.use((req, res) => {
  console.warn(`404 -> ${req.method} ${req.url}`);
  res.status(404).json({ message: 'Ruta no encontrada' });
});

// Error handler global
app.use((err, _req, res, _next) => {
  console.error('ERROR:', {
    code: err.code,
    message: err.message,
    stack: err.stack?.split('\n').slice(0, 2).join(' | '),
  });
  
  if (err.code) {
    return res.status(500).json({ message: err.message, code: err.code });
  }
  
  res.status(500).json({ message: err.message || 'Error interno del servidor' });
});

// ===== INICIO DEL SERVIDOR =====
(async () => {
  try {
    // Verificar conexión a la base de datos
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    console.log('✅ Conexión a MySQL exitosa');

    // Detectar IP LAN
    const nets = os.networkInterfaces();
    let lanIP = '127.0.0.1';
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          lanIP = net.address;
        }
      }
    }

    // Iniciar servidor
    app.listen(PORT, '0.0.0.0', () => {
      console.log('\n🚀 AquaSense API v2.0 - Servidor iniciado');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`📡 Local:  http://127.0.0.1:${PORT}`);
      console.log(`🌐 LAN:    http://${lanIP}:${PORT}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📁 Módulos cargados:');
      console.log('   • Auth (registro, login, cambio de contraseña)');
      console.log('   • Instalaciones (CRUD)');
      console.log('   • Sensores (catálogo, instalación, lecturas)');
      console.log('   • Umbrales (configuración, predeterminados)');
      console.log('   • Alertas (gestión, estadísticas)');
      console.log('   • Tareas programadas (aeradores)');
      console.log('   • Lecturas (resúmenes horarios)');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    });
  } catch (err) {
    console.error('❌ No se pudo iniciar el servidor:', err.code, err.message);
    process.exit(1);
  }
})();

module.exports = app;
