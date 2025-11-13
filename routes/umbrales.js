// routes/umbrales.js
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const asyncHandler = require('../middleware/asyncHandler');

// Obtener umbral de un sensor
router.get('/sensor/:id', asyncHandler(async (req, res) => {
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
router.post('/sensor/:id', asyncHandler(async (req, res) => {
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
router.put('/:id', asyncHandler(async (req, res) => {
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
router.delete('/:id', asyncHandler(async (req, res) => {
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
router.put('/:id/estado', asyncHandler(async (req, res) => {
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
router.get('/instalacion/:id', asyncHandler(async (req, res) => {
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
router.get('/predeterminados/:tipo', asyncHandler(async (req, res) => {
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

module.exports = router;
