// routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const pool = require('../config/database');
const asyncHandler = require('../middleware/asyncHandler');
const { JWT_SECRET } = require('../config/constants');

// Registro
router.post(['/register', '/api/auth/register'], asyncHandler(async (req, res) => {
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

// Login
router.post(['/login', '/api/auth/login'], asyncHandler(async (req, res) => {
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
router.post(['/change-password', '/api/auth/change-password'], asyncHandler(async (req, res) => {
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

module.exports = router;
