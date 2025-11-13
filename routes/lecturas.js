// routes/lecturas.js
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const asyncHandler = require('../middleware/asyncHandler');

// Lecturas resumidas para home
router.get('/resumen', asyncHandler(async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT r.id_resumen, r.id_sensor_instalado, r.fecha, r.hora, r.promedio, r.registros
       FROM resumen_lectura_horaria r
      ORDER BY r.fecha DESC, r.hora DESC
      LIMIT 20`
  );
  res.json(rows);
}));

module.exports = router;
