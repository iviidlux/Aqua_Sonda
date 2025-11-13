// server.js (local LAN)
require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const os = require('os');

const app = express();
app.use(cors());
app.use(express.json());

// ===== Config =====
const PORT = parseInt(process.env.PORT || '3000', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'secreto_local_super_seguro';

// >>> MySQL local (o usa .env)
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || 'Mvergel',
  database: process.env.DB_NAME || 'u889902058_sonda0109_local',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
});

// ===== util =====
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ===== logger simple =====
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ===== health =====
app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'aquasense-api',
    endpoints: [
      '/debug/db-ping',
      '/api/instalaciones',
      '/api/instalaciones/:id/sensores',
      '/api/lecturas/resumen',
      '/api/instalaciones/ping',
    ],
  });
});

app.get('/debug/db-ping', asyncHandler(async (_req, res) => {
  const [rows] = await pool.query('SELECT 1 AS ok');
  res.json({ ok: rows[0].ok, db: (process.env.DB_NAME || 'u889902058_sonda0109_local') });
}));

app.get('/api/instalaciones/ping', (_req, res) => {
  res.json({ ok: true, route: '/api/instalaciones/ping' });
});

// =====================
// AUTH
// =====================
app.post(['/api/auth/register', '/auth/register'], asyncHandler(async (req, res) => {
  const { nombre, rol, correo, password } = req.body;
  if (!nombre || !rol || !correo || !password) {
    return res.status(400).json({ message: 'Campos incompletos' });
  }

  const [roles] = await pool.query('SELECT id_rol FROM tipo_rol WHERE nombre = ?', [rol]);
  if (roles.length === 0) return res.status(400).json({ message: 'Rol inválido' });
  const idRol = roles[0].id_rol;

  const [exist] = await pool.query('SELECT id_usuario FROM usuario WHERE correo = ?', [correo]);
  if (exist.length > 0) return res.status(409).json({ message: 'El correo ya existe' });

  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO usuario (id_rol, nombre_completo, correo, telefono, password_hash, estado)
     VALUES (?, ?, ?, NULL, ?, 'activo')`,
    [idRol, nombre, correo, hash]
  );

  const token = jwt.sign({ correo, rol }, JWT_SECRET, { expiresIn: '2h' });
  res.status(201).json({ message: 'Registrado', token, nombre, rol, correo });
}));

app.post(['/api/auth/login', '/auth/login'], asyncHandler(async (req, res) => {
  const { correo, password } = req.body;
  if (!correo || !password) return res.status(400).json({ message: 'Campos incompletos' });

  const [rows] = await pool.query(
    `SELECT u.id_usuario, u.password_hash, u.estado, r.nombre AS rol, u.nombre_completo
       FROM usuario u
       JOIN tipo_rol r ON r.id_rol = u.id_rol
      WHERE u.correo = ?`,
    [correo]
  );

  if (rows.length === 0) return res.status(401).json({ message: 'Credenciales inválidas' });
  const u = rows[0];
  if (u.estado !== 'activo') return res.status(403).json({ message: 'Usuario inactivo' });

  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return res.status(401).json({ message: 'Credenciales inválidas' });

  const token = jwt.sign({ uid: u.id_usuario, rol: u.rol, correo }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, nombre: u.nombre_completo, rol: u.rol, correo });
}));

// Cambiar contraseña (requiere autenticación)
app.post(['/api/auth/change-password', '/auth/change-password'], asyncHandler(async (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  
  if (!token) {
    return res.status(401).json({ message: 'Token requerido' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ message: 'Token inválido o expirado' });
  }

  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Campos incompletos' });
  }

  // Validar longitud mínima de la nueva contraseña
  if (newPassword.length < 6) {
    return res.status(400).json({ message: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }

  // Obtener el correo del token
  const correo = decoded.correo;
  if (!correo) {
    return res.status(401).json({ message: 'Token inválido' });
  }

  const [rows] = await pool.query(
    `SELECT id_usuario, password_hash, estado
       FROM usuario
      WHERE correo = ?`,
    [correo]
  );
  
  if (rows.length === 0) {
    return res.status(404).json({ message: 'Usuario no encontrado' });
  }
  
  const u = rows[0];
  if (u.estado !== 'activo') {
    return res.status(403).json({ message: 'Usuario inactivo' });
  }

  // Verificar que la contraseña actual sea correcta
  const ok = await bcrypt.compare(currentPassword, u.password_hash);
  if (!ok) {
    return res.status(401).json({ message: 'Contraseña actual incorrecta' });
  }

  // Verificar que la nueva contraseña sea diferente a la actual
  const samePassword = await bcrypt.compare(newPassword, u.password_hash);
  if (samePassword) {
    return res.status(400).json({ message: 'La nueva contraseña debe ser diferente a la actual' });
  }

  // Actualizar la contraseña
  const newHash = await bcrypt.hash(newPassword, 10);
  await pool.query('UPDATE usuario SET password_hash = ? WHERE id_usuario = ?', [newHash, u.id_usuario]);
  
  console.log('✅ Contraseña actualizada para usuario:', correo);
  res.json({ message: 'Contraseña actualizada exitosamente' });
}));

// =====================
// HOME: Lecturas resumidas
// =====================
app.get('/api/lecturas/resumen', asyncHandler(async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT r.id_resumen, r.id_sensor_instalado, r.fecha, r.hora, r.promedio, r.registros
       FROM resumen_lectura_horaria r
      ORDER BY r.fecha DESC, r.hora DESC
      LIMIT 20`
  );
  res.json(rows);
}));

// =====================
// INSTALACIONES
// =====================

// Listado de instalaciones (mapeando campos reales)
app.get('/api/instalaciones', asyncHandler(async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT 
        i.id_instalacion,
        i.nombre_instalacion AS nombre,
        COALESCE(NULLIF(i.descripcion,''), '') AS ubicacion,
        i.estado_operativo AS estado,
        COALESCE(COUNT(si.id_sensor_instalado), 0) AS sensores
       FROM instalacion i
  LEFT JOIN sensor_instalado si ON si.id_instalacion = i.id_instalacion
      WHERE COALESCE(i.estado_operativo, 'activo') <> 'eliminado'
   GROUP BY i.id_instalacion, i.nombre_instalacion, i.descripcion, i.estado_operativo
   ORDER BY i.nombre_instalacion ASC`
  );
  res.json(rows);
}));

// Eliminación suave de instalación (marca estado_operativo='eliminado')
app.delete('/api/instalaciones/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id) || 0;
  if (!id) return res.status(400).json({ message: 'ID inválido' });
  const [result] = await pool.query(
    `UPDATE instalacion SET estado_operativo = 'eliminado' WHERE id_instalacion = ?`,
    [id]
  );
  if (result.affectedRows === 0) {
    return res.status(404).json({ message: 'Instalación no encontrada' });
  }
  res.json({ ok: true, id, estado: 'eliminado' });
}));

// =====================
// SENSORES
// =====================

// Catálogo de sensores disponibles
app.get('/api/sensores/catalogo', asyncHandler(async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT id_sensor, nombre, unidad, tipo_medida, rango_min, rango_max
       FROM catalogo_sensores
      ORDER BY nombre ASC`
  );
  res.json(rows);
}));

// Crear nuevo tipo de sensor en catálogo
app.post('/api/sensores/catalogo', asyncHandler(async (req, res) => {
  const { nombre, unidad, tipo_medida, rango_min, rango_max } = req.body;
  if (!nombre) {
    return res.status(400).json({ message: 'Nombre es requerido' });
  }

  const [result] = await pool.query(
    `INSERT INTO catalogo_sensores (nombre, unidad, tipo_medida, rango_min, rango_max)
     VALUES (?, ?, ?, ?, ?)`,
    [nombre, unidad, tipo_medida, rango_min, rango_max]
  );

  const [rows] = await pool.query(
    `SELECT * FROM catalogo_sensores WHERE id_sensor = ?`,
    [result.insertId]
  );
  res.status(201).json(rows[0]);
}));

// Listar sensores instalados en una instalación
app.get('/api/instalaciones/:id/sensores', asyncHandler(async (req, res) => {
  const idInstalacion = Number(req.params.id) || 0;
  if (!idInstalacion) {
    return res.status(400).json({ message: 'ID inválido' });
  }

  const [rows] = await pool.query(
    `SELECT 
       si.id_sensor_instalado,
       si.id_instalacion,
       si.id_sensor,
       cs.nombre AS nombre_sensor,
       COALESCE(si.alias, cs.nombre) AS nombre,
       cs.tipo_medida AS parametro,
       cs.tipo_medida AS tipo,
       cs.unidad,
       si.estado,
       si.valor_actual AS valor,
       si.ultima_lectura,
       si.descripcion,
       si.fecha_instalada AS fecha_instalacion
     FROM sensor_instalado si
     JOIN catalogo_sensores cs ON cs.id_sensor = si.id_sensor
     WHERE si.id_instalacion = ?
     ORDER BY si.fecha_creacion DESC`,
    [idInstalacion]
  );
  res.json(rows);
}));

// Instalar sensor en instalación
app.post('/api/instalaciones/:id/sensores', asyncHandler(async (req, res) => {
  const idInstalacion = Number(req.params.id) || 0;
  const { id_sensor, alias, descripcion } = req.body;

  if (!idInstalacion || !id_sensor) {
    return res.status(400).json({ message: 'id_instalacion e id_sensor son requeridos' });
  }

  // Verificar que el sensor del catálogo existe
  const [sensorExiste] = await pool.query(
    `SELECT id_sensor FROM catalogo_sensores WHERE id_sensor = ?`,
    [id_sensor]
  );

  if (sensorExiste.length === 0) {
    return res.status(404).json({ message: 'Sensor no encontrado en catálogo' });
  }

  const [result] = await pool.query(
    `INSERT INTO sensor_instalado (id_instalacion, id_sensor, alias, descripcion, estado, fecha_instalada)
     VALUES (?, ?, ?, ?, 'activo', CURDATE())`,
    [idInstalacion, id_sensor, alias, descripcion]
  );

  const [rows] = await pool.query(
    `SELECT 
       si.id_sensor_instalado,
       si.id_instalacion,
       si.id_sensor,
       cs.nombre AS nombre_sensor,
       COALESCE(si.alias, cs.nombre) AS nombre,
       cs.tipo_medida AS parametro,
       cs.unidad,
       si.estado,
       si.valor_actual AS valor,
       si.ultima_lectura,
       si.descripcion
     FROM sensor_instalado si
     JOIN catalogo_sensores cs ON cs.id_sensor = si.id_sensor
     WHERE si.id_sensor_instalado = ?`,
    [result.insertId]
  );

  res.status(201).json(rows[0]);
}));

// Desinstalar sensor
app.delete('/api/sensores/instalados/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id) || 0;
  if (!id) return res.status(400).json({ message: 'ID inválido' });

  const [result] = await pool.query(
    `DELETE FROM sensor_instalado WHERE id_sensor_instalado = ?`,
    [id]
  );

  if (result.affectedRows === 0) {
    return res.status(404).json({ message: 'Sensor no encontrado' });
  }

  res.json({ ok: true, id });
}));

// Obtener lecturas de un sensor
app.get('/api/sensores/:id/lecturas', asyncHandler(async (req, res) => {
  const idSensorInstalado = Number(req.params.id) || 0;
  const limit = Number(req.query.limit) || 50;

  if (!idSensorInstalado) {
    return res.status(400).json({ message: 'ID inválido' });
  }

  const [rows] = await pool.query(
    `SELECT id_lectura, id_sensor_instalado, valor, tomada_en AS timestamp
     FROM lectura
     WHERE id_sensor_instalado = ?
     ORDER BY tomada_en DESC
     LIMIT ?`,
    [idSensorInstalado, limit]
  );

  res.json(rows);
}));

// Enviar lectura manual (para testing)
app.post('/api/sensores/:id/lecturas', asyncHandler(async (req, res) => {
  const idSensorInstalado = Number(req.params.id) || 0;
  const { valor, timestamp } = req.body;

  if (!idSensorInstalado || valor === undefined) {
    return res.status(400).json({ message: 'id_sensor_instalado y valor son requeridos' });
  }

  const tomadaEn = timestamp || new Date().toISOString();

  const [result] = await pool.query(
    `INSERT INTO lectura (id_sensor_instalado, valor, tomada_en)
     VALUES (?, ?, ?)`,
    [idSensorInstalado, valor, tomadaEn]
  );

  res.status(201).json({
    id_lectura: result.insertId,
    id_sensor_instalado: idSensorInstalado,
    valor,
    timestamp: tomadaEn
  });
}));

// Cambiar estado del sensor
app.put('/api/sensores/instalados/:id/estado', asyncHandler(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const { estado } = req.body;

  if (!id || !estado) {
    return res.status(400).json({ message: 'ID y estado son requeridos' });
  }

  const estadosValidos = ['activo', 'inactivo', 'mantenimiento', 'error'];
  if (!estadosValidos.includes(estado)) {
    return res.status(400).json({ message: 'Estado inválido' });
  }

  const [result] = await pool.query(
    `UPDATE sensor_instalado SET estado = ? WHERE id_sensor_instalado = ?`,
    [estado, id]
  );

  if (result.affectedRows === 0) {
    return res.status(404).json({ message: 'Sensor no encontrado' });
  }

  res.json({ ok: true, id, estado });
}));

// =====================
// UMBRALES
// =====================

// Obtener umbral de un sensor
app.get('/api/sensores/:id/umbral', asyncHandler(async (req, res) => {
  const idSensorInstalado = Number(req.params.id) || 0;

  const [rows] = await pool.query(
    `SELECT id_umbral, id_sensor_instalado, valor_minimo, valor_maximo, 
            valor_optimo, nivel_alerta, activo, created_at, updated_at
     FROM umbral_sensor
     WHERE id_sensor_instalado = ?`,
    [idSensorInstalado]
  );

  if (rows.length === 0) {
    return res.json(null);
  }

  res.json(rows[0]);
}));

// Crear o actualizar umbral de un sensor
app.post('/api/sensores/:id/umbral', asyncHandler(async (req, res) => {
  const idSensorInstalado = Number(req.params.id) || 0;
  const { valor_minimo, valor_maximo, valor_optimo, nivel_alerta, activo } = req.body;

  if (!idSensorInstalado) {
    return res.status(400).json({ message: 'ID inválido' });
  }

  // Insertar o actualizar
  await pool.query(
    `INSERT INTO umbral_sensor 
       (id_sensor_instalado, valor_minimo, valor_maximo, valor_optimo, nivel_alerta, activo)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       valor_minimo = VALUES(valor_minimo),
       valor_maximo = VALUES(valor_maximo),
       valor_optimo = VALUES(valor_optimo),
       nivel_alerta = VALUES(nivel_alerta),
       activo = VALUES(activo),
       updated_at = CURRENT_TIMESTAMP`,
    [
      idSensorInstalado,
      valor_minimo,
      valor_maximo,
      valor_optimo,
      nivel_alerta || 'warning',
      activo !== false ? 1 : 0
    ]
  );

  const [rows] = await pool.query(
    `SELECT * FROM umbral_sensor WHERE id_sensor_instalado = ?`,
    [idSensorInstalado]
  );

  res.json(rows[0]);
}));

// Actualizar umbral existente por ID
app.put('/api/umbrales/:id', asyncHandler(async (req, res) => {
  const idUmbral = Number(req.params.id) || 0;
  const { valor_minimo, valor_maximo, valor_optimo, nivel_alerta, activo } = req.body;

  if (!idUmbral) {
    return res.status(400).json({ message: 'ID inválido' });
  }

  const [result] = await pool.query(
    `UPDATE umbral_sensor
     SET valor_minimo = ?, valor_maximo = ?, valor_optimo = ?, 
         nivel_alerta = ?, activo = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id_umbral = ?`,
    [valor_minimo, valor_maximo, valor_optimo, nivel_alerta, activo ? 1 : 0, idUmbral]
  );

  if (result.affectedRows === 0) {
    return res.status(404).json({ message: 'Umbral no encontrado' });
  }

  const [rows] = await pool.query(
    `SELECT * FROM umbral_sensor WHERE id_umbral = ?`,
    [idUmbral]
  );

  res.json(rows[0]);
}));

// Eliminar umbral
app.delete('/api/umbrales/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id) || 0;
  if (!id) return res.status(400).json({ message: 'ID inválido' });

  const [result] = await pool.query(
    `DELETE FROM umbral_sensor WHERE id_umbral = ?`,
    [id]
  );

  if (result.affectedRows === 0) {
    return res.status(404).json({ message: 'Umbral no encontrado' });
  }

  res.json({ ok: true, id });
}));

// Cambiar estado de umbral
app.put('/api/umbrales/:id/estado', asyncHandler(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const { activo } = req.body;

  if (!id) {
    return res.status(400).json({ message: 'ID inválido' });
  }

  const [result] = await pool.query(
    `UPDATE umbral_sensor SET activo = ?, updated_at = CURRENT_TIMESTAMP WHERE id_umbral = ?`,
    [activo ? 1 : 0, id]
  );

  if (result.affectedRows === 0) {
    return res.status(404).json({ message: 'Umbral no encontrado' });
  }

  res.json({ ok: true, id, activo });
}));

// Obtener umbrales de una instalación
app.get('/api/instalaciones/:id/umbrales', asyncHandler(async (req, res) => {
  const idInstalacion = Number(req.params.id) || 0;

  const [rows] = await pool.query(
    `SELECT u.*, si.id_instalacion
     FROM umbral_sensor u
     JOIN sensor_instalado si ON si.id_sensor_instalado = u.id_sensor_instalado
     WHERE si.id_instalacion = ?`,
    [idInstalacion]
  );

  res.json(rows);
}));

// Obtener umbrales predeterminados por tipo de medida
app.get('/api/umbrales/predeterminados/:tipo', asyncHandler(async (req, res) => {
  const tipoMedida = req.params.tipo;

  const [rows] = await pool.query(
    `SELECT valor_minimo, valor_maximo, valor_optimo, descripcion
     FROM umbrales_recomendados
     WHERE tipo_medida = ? AND especie IS NULL
     LIMIT 1`,
    [tipoMedida]
  );

  if (rows.length === 0) {
    return res.json({
      valor_minimo: null,
      valor_maximo: null,
      valor_optimo: null,
      descripcion: 'Sin valores predeterminados'
    });
  }

  res.json(rows[0]);
}));

// =====================
// ALERTAS
// =====================

// Obtener alertas por instalación
app.get('/api/instalaciones/:id/alertas', asyncHandler(async (req, res) => {
  const idInstalacion = Number(req.params.id) || 0;
  const limit = Number(req.query.limit) || 50;
  const noLeidas = req.query.no_leidas === 'true';
  const noResueltas = req.query.no_resueltas === 'true';

  let query = `
    SELECT 
      a.id_alerta,
      a.id_instalacion,
      a.id_sensor_instalado,
      a.tipo_alerta,
      a.mensaje,
      a.nivel,
      a.valor_registrado,
      a.atendida,
      a.leida,
      a.resuelta,
      a.fecha_creacion AS fecha_generada,
      a.fecha_resuelta,
      a.metadata
    FROM alertas a
    WHERE a.id_instalacion = ?
  `;

  const params = [idInstalacion];

  if (noLeidas) {
    query += ` AND a.leida = 0`;
  }

  if (noResueltas) {
    query += ` AND a.resuelta = 0`;
  }

  query += ` ORDER BY a.fecha_creacion DESC LIMIT ?`;
  params.push(limit);

  const [rows] = await pool.query(query, params);
  res.json(rows);
}));

// Obtener alertas por sensor
app.get('/api/sensores/:id/alertas', asyncHandler(async (req, res) => {
  const idSensorInstalado = Number(req.params.id) || 0;
  const limit = Number(req.query.limit) || 50;

  const [rows] = await pool.query(
    `SELECT 
       a.id_alerta,
       a.id_instalacion,
       a.id_sensor_instalado,
       a.tipo_alerta,
       a.mensaje,
       a.nivel,
       a.valor_registrado,
       a.leida,
       a.resuelta,
       a.fecha_creacion AS fecha_generada,
       a.fecha_resuelta
     FROM alertas a
     WHERE a.id_sensor_instalado = ?
     ORDER BY a.fecha_creacion DESC
     LIMIT ?`,
    [idSensorInstalado, limit]
  );

  res.json(rows);
}));

// Marcar alerta como leída
app.put('/api/alertas/:id/leer', asyncHandler(async (req, res) => {
  const id = Number(req.params.id) || 0;

  const [result] = await pool.query(
    `UPDATE alertas SET leida = 1 WHERE id_alerta = ?`,
    [id]
  );

  if (result.affectedRows === 0) {
    return res.status(404).json({ message: 'Alerta no encontrada' });
  }

  res.json({ ok: true, id, leida: true });
}));

// Marcar alerta como resuelta
app.put('/api/alertas/:id/resolver', asyncHandler(async (req, res) => {
  const id = Number(req.params.id) || 0;

  const [result] = await pool.query(
    `UPDATE alertas 
     SET resuelta = 1, atendida = 1, fecha_resuelta = CURRENT_TIMESTAMP 
     WHERE id_alerta = ?`,
    [id]
  );

  if (result.affectedRows === 0) {
    return res.status(404).json({ message: 'Alerta no encontrada' });
  }

  res.json({ ok: true, id, resuelta: true });
}));

// Marcar todas las alertas de una instalación como leídas
app.put('/api/instalaciones/:id/alertas/leer-todas', asyncHandler(async (req, res) => {
  const idInstalacion = Number(req.params.id) || 0;

  const [result] = await pool.query(
    `UPDATE alertas SET leida = 1 WHERE id_instalacion = ? AND leida = 0`,
    [idInstalacion]
  );

  res.json({ ok: true, actualizadas: result.affectedRows });
}));

// Contar alertas no leídas
app.get('/api/instalaciones/:id/alertas/count', asyncHandler(async (req, res) => {
  const idInstalacion = Number(req.params.id) || 0;

  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count FROM alertas WHERE id_instalacion = ? AND leida = 0`,
    [idInstalacion]
  );

  res.json({ count: rows[0].count });
}));

// Crear alerta manualmente
app.post('/api/alertas', asyncHandler(async (req, res) => {
  const {
    id_instalacion,
    id_sensor_instalado,
    tipo_alerta,
    mensaje,
    nivel,
    valor_registrado,
    metadata
  } = req.body;

  if (!id_instalacion || !mensaje || !nivel) {
    return res.status(400).json({ message: 'Campos requeridos: id_instalacion, mensaje, nivel' });
  }

  const [result] = await pool.query(
    `INSERT INTO alertas 
       (id_instalacion, id_sensor_instalado, tipo_alerta, mensaje, nivel, valor_registrado, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id_instalacion,
      id_sensor_instalado,
      tipo_alerta || 'manual',
      mensaje,
      nivel,
      valor_registrado,
      metadata ? JSON.stringify(metadata) : null
    ]
  );

  const [rows] = await pool.query(
    `SELECT * FROM alertas WHERE id_alerta = ?`,
    [result.insertId]
  );

  res.status(201).json(rows[0]);
}));

// Eliminar alerta
app.delete('/api/alertas/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id) || 0;
  if (!id) return res.status(400).json({ message: 'ID inválido' });

  const [result] = await pool.query(
    `DELETE FROM alertas WHERE id_alerta = ?`,
    [id]
  );

  if (result.affectedRows === 0) {
    return res.status(404).json({ message: 'Alerta no encontrada' });
  }

  res.json({ ok: true, id });
}));

// Obtener estadísticas de alertas
app.get('/api/instalaciones/:id/alertas/estadisticas', asyncHandler(async (req, res) => {
  const idInstalacion = Number(req.params.id) || 0;

  const [stats] = await pool.query(
    `SELECT 
       COUNT(*) AS total,
       SUM(CASE WHEN leida = 0 THEN 1 ELSE 0 END) AS no_leidas,
       SUM(CASE WHEN resuelta = 0 THEN 1 ELSE 0 END) AS no_resueltas,
       SUM(CASE WHEN nivel = 'critical' THEN 1 ELSE 0 END) AS criticas,
       SUM(CASE WHEN nivel = 'warning' THEN 1 ELSE 0 END) AS advertencias,
       SUM(CASE WHEN nivel = 'info' THEN 1 ELSE 0 END) AS informativas
     FROM alertas
     WHERE id_instalacion = ?`,
    [idInstalacion]
  );

  res.json(stats[0]);
}));

// =====================
// TAREAS PROGRAMADAS (AERADOR)
// =====================

// Listar tareas por instalación
app.get('/api/tareas-programadas/:idInstalacion', asyncHandler(async (req, res) => {
  const idInstalacion = Number(req.params.idInstalacion) || 0;
  const [rows] = await pool.query(
    `SELECT * FROM tarea_programada WHERE id_instalacion = ? ORDER BY creado DESC`,
    [idInstalacion]
  );
  res.json(rows);
}));

// Crear tarea programada
app.post('/api/tareas-programadas', asyncHandler(async (req, res) => {
  const {
    id_instalacion,
    nombre,
    tipo,
    hora_inicio,
    hora_fin,
    oxigeno_min,
    oxigeno_max,
    duracion_minutos,
    accion,
    activo
  } = req.body;
  if (!id_instalacion || !nombre || !accion) {
    return res.status(400).json({ message: 'Campos requeridos faltantes' });
  }
  const [result] = await pool.query(
    `INSERT INTO tarea_programada
      (id_instalacion, nombre, tipo, hora_inicio, hora_fin, oxigeno_min, oxigeno_max, duracion_minutos, accion, activo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id_instalacion, nombre, tipo || 'horario', hora_inicio, hora_fin, oxigeno_min, oxigeno_max, duracion_minutos, accion, activo ? 1 : 0]
  );
  const [rows] = await pool.query('SELECT * FROM tarea_programada WHERE id_tarea = ?', [result.insertId]);
  res.status(201).json(rows[0]);
}));

// Editar tarea programada
app.put('/api/tareas-programadas/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const fields = req.body;
  if (!id) return res.status(400).json({ message: 'ID inválido' });
  const sets = [];
  const vals = [];
  for (const k of Object.keys(fields)) {
    sets.push(`${k} = ?`);
    vals.push(fields[k]);
  }
  if (sets.length === 0) return res.status(400).json({ message: 'Nada que actualizar' });
  vals.push(id);
  await pool.query(`UPDATE tarea_programada SET ${sets.join(', ')} WHERE id_tarea = ?`, vals);
  const [rows] = await pool.query('SELECT * FROM tarea_programada WHERE id_tarea = ?', [id]);
  res.json(rows[0]);
}));

// Eliminar tarea programada
app.delete('/api/tareas-programadas/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id) || 0;
  if (!id) return res.status(400).json({ message: 'ID inválido' });
  await pool.query('DELETE FROM tarea_programada WHERE id_tarea = ?', [id]);
  res.json({ ok: true, id });
}));

// Sensores por instalación (DETALLE TOLERANTE a columnas nombre/alias)
app.get('/api/instalaciones/:id/sensores', asyncHandler(async (req, res) => {
  const id = Number(req.params.id) || 0;

  const [rows] = await pool.query(
    `SELECT 
        si.id_sensor_instalado,
        COALESCE(si.nombre, si.alias, CONCAT('Sensor ', si.id_sensor_instalado)) AS nombre_sensor,
        si.estado,
        cs.nombre AS tipo_sensor,
        p.nombre  AS parametro,
        p.unidad  AS unidad,
        (SELECT CONCAT(r.fecha, ' ', r.hora, ' • ', r.promedio)
           FROM resumen_lectura_horaria r
          WHERE r.id_sensor_instalado = si.id_sensor_instalado
          ORDER BY r.fecha DESC, r.hora DESC
          LIMIT 1) AS ultima_lectura
     FROM sensor_instalado si
     LEFT JOIN catalogo_sensores cs 
            ON cs.id_catalogo_sensor = si.id_catalogo_sensor
     LEFT JOIN parametros p 
            ON p.id_parametro = si.id_parametro
    WHERE si.id_instalacion = ?
    ORDER BY si.id_sensor_instalado DESC`,
    [id]
  );

  res.json(rows);
}));
// === whoami (debug) ===
app.get('/whoami', (_req, res) => {
  const os = require('os');
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

// 404
app.use((req, res) => {
  console.warn(`404 -> ${req.method} ${req.url}`);
  res.status(404).json({ message: 'Ruta no encontrada' });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error('ERROR:', {
    code: err.code,
    message: err.message,
    stack: err.stack?.split('\n').slice(0, 2).join(' | '),
  });
  if (err.code) {
    return res.status(500).json({ message: err.message, code: err.code });
  }
  res.status(500).json({ message: err.message || 'Error interno' });
});

// start + ping inicial
(async () => {
  try {
    const c = await pool.getConnection();
    await c.ping();
    c.release();

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

    app.listen(PORT, '0.0.0.0', () => {
      console.log('✅ API corriendo en:');
      console.log(`   • Local: http://127.0.0.1:${PORT}`);
      console.log(`   • LAN:   http://${lanIP}:${PORT}`);
      console.log('   Endpoints: /api/instalaciones, /api/instalaciones/:id/sensores, /api/lecturas/resumen');
    });
  } catch (e) {
    console.error('❌ No se pudo conectar a MySQL:', e.code, e.message);
    process.exit(1);
  }
})();
