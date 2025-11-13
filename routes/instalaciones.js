// routes/instalaciones.js
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const asyncHandler = require('../middleware/asyncHandler');

// Listado de instalaciones
router.get('/', asyncHandler(async (_req, res) => {
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

// Eliminación suave de instalación
router.delete('/:id', asyncHandler(async (req, res) => {
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

// Sensores por instalación (DETALLE)
router.get('/:id/sensores', asyncHandler(async (req, res) => {
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

// Ping
router.get('/ping', (_req, res) => {
  res.json({ ok: true, route: '/api/instalaciones/ping' });
});

module.exports = router;
