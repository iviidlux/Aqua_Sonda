// routes/alertas.js
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const asyncHandler = require('../middleware/asyncHandler');

// Obtener alertas por instalación
router.get('/instalacion/:id', asyncHandler(async (req, res) => {
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

// Marcar alerta como leída
router.put('/:id/leer', asyncHandler(async (req, res) => {
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
router.put('/:id/resolver', asyncHandler(async (req, res) => {
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
router.put('/instalacion/:id/leer-todas', asyncHandler(async (req, res) => {
  const idInstalacion = Number(req.params.id) || 0;

  const [result] = await pool.query(
    `UPDATE alertas SET leida = 1 WHERE id_instalacion = ? AND leida = 0`,
    [idInstalacion]
  );

  res.json({ ok: true, actualizadas: result.affectedRows });
}));

// Contar alertas no leídas
router.get('/instalacion/:id/count', asyncHandler(async (req, res) => {
  const idInstalacion = Number(req.params.id) || 0;

  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count FROM alertas WHERE id_instalacion = ? AND leida = 0`,
    [idInstalacion]
  );

  res.json({ count: rows[0].count });
}));

// Crear alerta manualmente
router.post('/', asyncHandler(async (req, res) => {
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
router.delete('/:id', asyncHandler(async (req, res) => {
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
router.get('/instalacion/:id/estadisticas', asyncHandler(async (req, res) => {
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

module.exports = router;
