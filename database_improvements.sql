-- ============================================================
-- MEJORAS PARA AQUA_SONDA - SISTEMA DE SENSORES Y ALERTAS
-- ============================================================
-- Fecha: 8 de noviembre de 2025
-- Descripción: Script para mejorar el sistema de sensores, agregar
--              umbrales y mejorar el sistema de alertas existente

-- ============================================================
-- 1. MEJORAR TABLA DE ALERTAS EXISTENTE
-- ============================================================

-- Agregar nuevas columnas a la tabla alertas existente
ALTER TABLE `alertas` 
ADD COLUMN `id_sensor_instalado` INT NULL AFTER `id_instalacion`,
ADD COLUMN `tipo_alerta` ENUM('umbral_excedido', 'sensor_offline', 'tarea_fallida', 'manual', 'otro') NOT NULL DEFAULT 'otro' AFTER `mensaje`,
ADD COLUMN `valor_registrado` DECIMAL(10,4) NULL AFTER `tipo_alerta`,
ADD COLUMN `leida` TINYINT(1) NOT NULL DEFAULT 0 AFTER `atendida`,
ADD COLUMN `resuelta` TINYINT(1) NOT NULL DEFAULT 0 AFTER `leida`,
ADD COLUMN `fecha_resuelta` DATETIME NULL AFTER `resuelta`,
ADD COLUMN `metadata` JSON NULL AFTER `fecha_resuelta`,
ADD INDEX `idx_alerta_sensor` (`id_sensor_instalado`),
ADD INDEX `idx_alerta_leida` (`leida`, `fecha_creacion`),
ADD INDEX `idx_alerta_resuelta` (`resuelta`),
ADD CONSTRAINT `fk_alerta_sensor` FOREIGN KEY (`id_sensor_instalado`) 
    REFERENCES `sensor_instalado` (`id_sensor_instalado`) 
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Nota: 'atendida' puede ser deprecada gradualmente a favor de 'leida' y 'resuelta'

-- ============================================================
-- 2. POBLAR CATÁLOGO DE SENSORES CON TIPOS PREDEFINIDOS
-- ============================================================

INSERT INTO `catalogo_sensores` (`nombre`, `unidad`, `tipo_medida`, `rango_min`, `rango_max`) 
VALUES
  ('pH', 'pH', 'ph', 0.000, 14.000),
  ('Oxígeno Disuelto', 'mg/L', 'oxigeno_disuelto', 0.000, 20.000),
  ('Temperatura del Agua', '°C', 'temperatura', 0.000, 50.000),
  ('Conductividad Eléctrica', 'µS/cm', 'conductividad', 0.000, 2000.000),
  ('Turbidez', 'NTU', 'turbidez', 0.000, 100.000),
  ('Salinidad', 'ppt', 'salinidad', 0.000, 50.000),
  ('Amonio (NH₄⁺)', 'mg/L', 'otro', 0.000, 10.000),
  ('Nitritos (NO₂⁻)', 'mg/L', 'otro', 0.000, 5.000),
  ('Nitratos (NO₃⁻)', 'mg/L', 'otro', 0.000, 100.000),
  ('Nivel de Agua', 'cm', 'otro', 0.000, 500.000),
  ('Presión', 'bar', 'otro', 0.000, 10.000),
  ('Cloro Residual', 'mg/L', 'otro', 0.000, 5.000)
ON DUPLICATE KEY UPDATE 
  `unidad` = VALUES(`unidad`),
  `tipo_medida` = VALUES(`tipo_medida`),
  `rango_min` = VALUES(`rango_min`),
  `rango_max` = VALUES(`rango_max`);

-- ============================================================
-- 3. MEJORAR TABLA SENSOR_INSTALADO
-- ============================================================

-- Agregar columnas útiles para gestión de sensores
ALTER TABLE `sensor_instalado`
ADD COLUMN `alias` VARCHAR(100) NULL COMMENT 'Nombre personalizado del sensor' AFTER `id_sensor`,
ADD COLUMN `estado` ENUM('activo', 'inactivo', 'mantenimiento', 'error') NOT NULL DEFAULT 'activo' AFTER `descripcion`,
ADD COLUMN `ultima_lectura` DATETIME NULL COMMENT 'Timestamp de la última lectura recibida' AFTER `estado`,
ADD COLUMN `valor_actual` DECIMAL(10,4) NULL COMMENT 'Último valor registrado' AFTER `ultima_lectura`,
ADD COLUMN `fecha_creacion` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `fecha_instalada`,
ADD COLUMN `ultima_modificacion` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `fecha_creacion`,
ADD INDEX `idx_si_estado` (`estado`),
ADD INDEX `idx_si_ultima_lectura` (`ultima_lectura`);

-- ============================================================
-- 4. CREAR TABLA DE UMBRALES PARA SENSORES
-- ============================================================

CREATE TABLE IF NOT EXISTS `umbral_sensor` (
  `id_umbral` INT NOT NULL AUTO_INCREMENT,
  `id_sensor_instalado` INT NOT NULL,
  `valor_minimo` DECIMAL(10,4) NULL COMMENT 'Valor mínimo aceptable',
  `valor_maximo` DECIMAL(10,4) NULL COMMENT 'Valor máximo aceptable',
  `valor_optimo` DECIMAL(10,4) NULL COMMENT 'Valor ideal u óptimo',
  `nivel_alerta` ENUM('info', 'warning', 'critical') NOT NULL DEFAULT 'warning' COMMENT 'Nivel de alerta al exceder umbral',
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `notificar` TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Si debe generar notificaciones',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_umbral`),
  UNIQUE KEY `uq_umbral_sensor` (`id_sensor_instalado`),
  KEY `idx_umbral_activo` (`activo`),
  CONSTRAINT `fk_umbral_sensor_instalado` FOREIGN KEY (`id_sensor_instalado`) 
    REFERENCES `sensor_instalado` (`id_sensor_instalado`) 
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
COMMENT='Umbrales configurados para cada sensor instalado';

-- ============================================================
-- 5. TRIGGER: ACTUALIZAR SENSOR CON ÚLTIMA LECTURA
-- ============================================================

-- Actualizar automáticamente sensor_instalado cuando hay una nueva lectura
DELIMITER $$

DROP TRIGGER IF EXISTS `trg_lectura_actualizar_sensor`$$

CREATE TRIGGER `trg_lectura_actualizar_sensor`
AFTER INSERT ON `lectura`
FOR EACH ROW
BEGIN
  UPDATE `sensor_instalado`
  SET 
    `ultima_lectura` = NEW.tomada_en,
    `valor_actual` = NEW.valor
  WHERE `id_sensor_instalado` = NEW.id_sensor_instalado;
END$$

DELIMITER ;

-- ============================================================
-- 6. TRIGGER: GENERAR ALERTAS AUTOMÁTICAS POR UMBRAL
-- ============================================================

DELIMITER $$

DROP TRIGGER IF EXISTS `trg_lectura_verificar_umbral`$$

CREATE TRIGGER `trg_lectura_verificar_umbral`
AFTER INSERT ON `lectura`
FOR EACH ROW
BEGIN
  DECLARE v_min DECIMAL(10,4);
  DECLARE v_max DECIMAL(10,4);
  DECLARE v_nivel VARCHAR(20);
  DECLARE v_activo TINYINT;
  DECLARE v_notificar TINYINT;
  DECLARE v_id_instalacion INT;
  DECLARE v_nombre_sensor VARCHAR(255);
  DECLARE v_mensaje TEXT;
  
  -- Obtener umbral configurado para este sensor
  SELECT 
    u.valor_minimo, 
    u.valor_maximo, 
    u.nivel_alerta, 
    u.activo,
    u.notificar,
    si.id_instalacion,
    COALESCE(si.alias, cs.nombre, 'Sensor')
  INTO 
    v_min, 
    v_max, 
    v_nivel, 
    v_activo,
    v_notificar,
    v_id_instalacion,
    v_nombre_sensor
  FROM umbral_sensor u
  JOIN sensor_instalado si ON si.id_sensor_instalado = u.id_sensor_instalado
  LEFT JOIN catalogo_sensores cs ON cs.id_sensor = si.id_sensor
  WHERE u.id_sensor_instalado = NEW.id_sensor_instalado
    AND u.activo = 1
  LIMIT 1;
  
  -- Si hay umbral configurado y está activo
  IF v_activo = 1 AND v_notificar = 1 THEN
    -- Verificar si se excedió el umbral mínimo
    IF v_min IS NOT NULL AND NEW.valor < v_min THEN
      SET v_mensaje = CONCAT(v_nombre_sensor, ' - Valor bajo: ', 
                            ROUND(NEW.valor, 2), 
                            ' (mínimo: ', ROUND(v_min, 2), ')');
      
      INSERT INTO alertas (
        id_instalacion, 
        id_sensor_instalado, 
        tipo_alerta,
        mensaje, 
        nivel, 
        valor_registrado,
        atendida,
        leida,
        resuelta
      ) VALUES (
        v_id_instalacion,
        NEW.id_sensor_instalado,
        'umbral_excedido',
        v_mensaje,
        v_nivel,
        NEW.valor,
        0,
        0,
        0
      );
    END IF;
    
    -- Verificar si se excedió el umbral máximo
    IF v_max IS NOT NULL AND NEW.valor > v_max THEN
      SET v_mensaje = CONCAT(v_nombre_sensor, ' - Valor alto: ', 
                            ROUND(NEW.valor, 2), 
                            ' (máximo: ', ROUND(v_max, 2), ')');
      
      INSERT INTO alertas (
        id_instalacion, 
        id_sensor_instalado, 
        tipo_alerta,
        mensaje, 
        nivel, 
        valor_registrado,
        atendida,
        leida,
        resuelta
      ) VALUES (
        v_id_instalacion,
        NEW.id_sensor_instalado,
        'umbral_excedido',
        v_mensaje,
        v_nivel,
        NEW.valor,
        0,
        0,
        0
      );
    END IF;
  END IF;
END$$

DELIMITER ;

-- ============================================================
-- 7. UMBRALES PREDETERMINADOS PARA ACUICULTURA
-- ============================================================

-- Tabla auxiliar con valores recomendados por tipo de sensor
CREATE TABLE IF NOT EXISTS `umbrales_recomendados` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `tipo_medida` VARCHAR(50) NOT NULL,
  `especie` VARCHAR(100) NULL COMMENT 'Especie específica o NULL para general',
  `valor_minimo` DECIMAL(10,4) NULL,
  `valor_maximo` DECIMAL(10,4) NULL,
  `valor_optimo` DECIMAL(10,4) NULL,
  `descripcion` VARCHAR(255) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tipo_especie` (`tipo_medida`, `especie`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
COMMENT='Valores recomendados de umbrales por tipo de medida y especie';

-- Insertar valores recomendados generales para acuicultura
INSERT INTO `umbrales_recomendados` (`tipo_medida`, `especie`, `valor_minimo`, `valor_maximo`, `valor_optimo`, `descripcion`) VALUES
  -- pH
  ('ph', NULL, 6.5, 8.5, 7.0, 'Rango general para peces de agua dulce'),
  ('ph', 'tilapia', 6.5, 9.0, 7.5, 'Rango óptimo para tilapia'),
  ('ph', 'trucha', 6.5, 8.5, 7.0, 'Rango óptimo para trucha'),
  ('ph', 'camaron', 7.5, 8.5, 8.0, 'Rango óptimo para camarón'),
  
  -- Oxígeno Disuelto
  ('oxigeno_disuelto', NULL, 5.0, 20.0, 7.0, 'Rango general para peces'),
  ('oxigeno_disuelto', 'tilapia', 3.0, 20.0, 5.0, 'Tilapia tolera niveles bajos'),
  ('oxigeno_disuelto', 'trucha', 6.0, 20.0, 8.0, 'Trucha requiere altos niveles'),
  ('oxigeno_disuelto', 'camaron', 4.0, 20.0, 6.0, 'Rango para camarón'),
  
  -- Temperatura
  ('temperatura', NULL, 15.0, 32.0, 25.0, 'Rango general'),
  ('temperatura', 'tilapia', 22.0, 32.0, 28.0, 'Temperatura óptima para tilapia'),
  ('temperatura', 'trucha', 10.0, 18.0, 15.0, 'Temperatura óptima para trucha'),
  ('temperatura', 'camaron', 25.0, 32.0, 28.0, 'Temperatura para camarón'),
  
  -- Amonio
  ('otro', 'amonio', 0.0, 0.5, 0.0, 'Niveles seguros de amonio NH₄⁺'),
  
  -- Nitritos
  ('otro', 'nitritos', 0.0, 0.2, 0.0, 'Niveles seguros de nitritos NO₂⁻'),
  
  -- Nitratos
  ('otro', 'nitratos', 0.0, 50.0, 10.0, 'Niveles seguros de nitratos NO₃⁻');

-- ============================================================
-- 8. VISTA ÚTIL: SENSORES CON SU ESTADO Y UMBRALES
-- ============================================================

CREATE OR REPLACE VIEW `v_sensores_estado` AS
SELECT 
  si.id_sensor_instalado,
  si.id_instalacion,
  i.nombre_instalacion,
  cs.id_sensor,
  cs.nombre AS nombre_sensor,
  cs.tipo_medida,
  cs.unidad,
  si.alias,
  si.descripcion,
  si.estado,
  si.valor_actual,
  si.ultima_lectura,
  si.fecha_instalada,
  -- Umbrales
  u.id_umbral,
  u.valor_minimo,
  u.valor_maximo,
  u.valor_optimo,
  u.nivel_alerta,
  u.activo AS umbral_activo,
  -- Verificación de estado
  CASE
    WHEN si.ultima_lectura IS NULL THEN 'sin_datos'
    WHEN si.ultima_lectura < DATE_SUB(NOW(), INTERVAL 1 HOUR) THEN 'offline'
    WHEN u.activo = 1 AND si.valor_actual IS NOT NULL THEN
      CASE
        WHEN (u.valor_minimo IS NOT NULL AND si.valor_actual < u.valor_minimo) OR
             (u.valor_maximo IS NOT NULL AND si.valor_actual > u.valor_maximo) THEN 'fuera_rango'
        ELSE 'normal'
      END
    ELSE 'normal'
  END AS estado_lectura,
  -- Alertas pendientes
  (SELECT COUNT(*) FROM alertas a 
   WHERE a.id_sensor_instalado = si.id_sensor_instalado 
   AND a.resuelta = 0) AS alertas_pendientes
FROM sensor_instalado si
JOIN instalacion i ON i.id_instalacion = si.id_instalacion
LEFT JOIN catalogo_sensores cs ON cs.id_sensor = si.id_sensor
LEFT JOIN umbral_sensor u ON u.id_sensor_instalado = si.id_sensor_instalado;

-- ============================================================
-- 9. PROCEDIMIENTO: CONFIGURAR UMBRAL AUTOMÁTICO
-- ============================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_configurar_umbral_automatico`$$

CREATE PROCEDURE `sp_configurar_umbral_automatico`(
  IN p_id_sensor_instalado INT,
  IN p_especie VARCHAR(100)
)
BEGIN
  DECLARE v_tipo_medida VARCHAR(50);
  DECLARE v_min DECIMAL(10,4);
  DECLARE v_max DECIMAL(10,4);
  DECLARE v_opt DECIMAL(10,4);
  
  -- Obtener tipo de medida del sensor
  SELECT cs.tipo_medida INTO v_tipo_medida
  FROM sensor_instalado si
  JOIN catalogo_sensores cs ON cs.id_sensor = si.id_sensor
  WHERE si.id_sensor_instalado = p_id_sensor_instalado;
  
  -- Buscar valores recomendados (primero específico de especie, luego general)
  SELECT valor_minimo, valor_maximo, valor_optimo
  INTO v_min, v_max, v_opt
  FROM umbrales_recomendados
  WHERE tipo_medida = v_tipo_medida
    AND (especie = p_especie OR (especie IS NULL AND p_especie IS NULL))
  ORDER BY especie DESC
  LIMIT 1;
  
  -- Insertar o actualizar umbral
  IF v_min IS NOT NULL OR v_max IS NOT NULL THEN
    INSERT INTO umbral_sensor (
      id_sensor_instalado,
      valor_minimo,
      valor_maximo,
      valor_optimo,
      nivel_alerta,
      activo
    ) VALUES (
      p_id_sensor_instalado,
      v_min,
      v_max,
      v_opt,
      'warning',
      1
    )
    ON DUPLICATE KEY UPDATE
      valor_minimo = v_min,
      valor_maximo = v_max,
      valor_optimo = v_opt,
      updated_at = CURRENT_TIMESTAMP;
  END IF;
END$$

DELIMITER ;

-- ============================================================
-- 10. ÍNDICES ADICIONALES PARA OPTIMIZACIÓN
-- ============================================================

-- Optimizar consultas de lecturas recientes
ALTER TABLE `lectura` 
ADD INDEX `idx_lectura_reciente` (`id_sensor_instalado`, `tomada_en` DESC);

-- Optimizar búsqueda de alertas por nivel
ALTER TABLE `alertas`
ADD INDEX `idx_alerta_nivel` (`nivel`, `fecha_creacion` DESC);

-- ============================================================
-- FIN DEL SCRIPT DE MEJORAS
-- ============================================================

-- Verificación: Mostrar resumen de mejoras aplicadas
SELECT 'Script de mejoras completado exitosamente' AS status;

SELECT 
  'Sensores en catálogo' AS tipo,
  COUNT(*) AS cantidad
FROM catalogo_sensores
UNION ALL
SELECT 
  'Sensores instalados' AS tipo,
  COUNT(*) AS cantidad
FROM sensor_instalado
UNION ALL
SELECT 
  'Umbrales configurados' AS tipo,
  COUNT(*) AS cantidad
FROM umbral_sensor
UNION ALL
SELECT 
  'Alertas registradas' AS tipo,
  COUNT(*) AS cantidad
FROM alertas;
