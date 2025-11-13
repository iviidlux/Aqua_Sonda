// routes/tareas.js
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const asyncHandler = require('../middleware/asyncHandler');

// Listar tareas por instalación
router.get('/:idInstalacion', asyncHandler(async (req, res) => {
  const idInstalacion = Number(req.params.idInstalacion) || 0;
  const [rows] = await pool.query(
    `SELECT * FROM tarea_programada WHERE id_instalacion = ? ORDER BY creado DESC`,
    [idInstalacion]
  );
  res.json(rows);
}));

// Crear tarea programada
router.post('/', asyncHandler(async (req, res) => {
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
router.put('/:id', asyncHandler(async (req, res) => {
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
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id) || 0;
  if (!id) return res.status(400).json({ message: 'ID inválido' });
  
  await pool.query('DELETE FROM tarea_programada WHERE id_tarea = ?', [id]);
  res.json({ ok: true, id });
}));

module.exports = router;
