// routes/sensores.js
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const asyncHandler = require('../middleware/asyncHandler');

// Catálogo de sensores disponibles
router.get('/catalogo', asyncHandler(async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT id_sensor, nombre, unidad, tipo_medida, rango_min, rango_max
       FROM catalogo_sensores
      ORDER BY nombre ASC`
  );
  res.json(rows);
}));

// Crear nuevo tipo de sensor en catálogo
router.post('/catalogo', asyncHandler(async (req, res) => {
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
router.get('/instalacion/:id', asyncHandler(async (req, res) => {
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
router.post('/instalacion/:id', asyncHandler(async (req, res) => {
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
router.delete('/instalados/:id', asyncHandler(async (req, res) => {
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
router.get('/:id/lecturas', asyncHandler(async (req, res) => {
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
router.post('/:id/lecturas', asyncHandler(async (req, res) => {
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
router.put('/instalados/:id/estado', asyncHandler(async (req, res) => {
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

// Obtener alertas de un sensor
router.get('/:id/alertas', asyncHandler(async (req, res) => {
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

module.exports = router;
