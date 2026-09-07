-- ============================================================================
-- SCRIPT DE MANTENIMIENTO, INTEGRIDAD Y SINCRONIZACIÓN POSTGRESQL (RENDER POS)
-- Arquitectura: Punto de Venta GastroBar Pro
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. DEDUPLICACIÓN Y ESTRUCTURACIÓN DE TABLAS CLAVE-VALOR Y LOGS
-- ----------------------------------------------------------------------------

-- A. Limpieza de duplicados en ConfigNegocio y asignación de Clave Primaria
DELETE FROM confignegocio a USING confignegocio b
WHERE a.ctid < b.ctid AND a.clave = b.clave;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'confignegocio' AND constraint_type = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE confignegocio ADD PRIMARY KEY (clave);
  END IF;
END $$;

-- B. Limpieza de duplicados en IdempotencyLog y asignación de Clave Primaria
DELETE FROM idempotencylog a USING idempotencylog b
WHERE a.ctid < b.ctid AND a.idempotency_key = b.idempotency_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'idempotencylog' AND constraint_type = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE idempotencylog ADD PRIMARY KEY (idempotency_key);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. CORRECCIÓN Y SANEAMIENTO DE REGISTROS HUÉRFANOS (FOREIGN KEYS)
-- ----------------------------------------------------------------------------

-- A. Órdenes con mesas eliminadas o reconfiguradas en el plano
UPDATE ordenes 
SET mesa_id = NULL 
WHERE mesa_id IS NOT NULL AND mesa_id NOT IN (SELECT id FROM mesas);

-- B. Detalle de órdenes con IDs de productos temporales/ficticios
UPDATE detalleorden 
SET producto_id = (SELECT MIN(id) FROM productos)
WHERE producto_id IS NOT NULL AND producto_id NOT IN (SELECT id FROM productos);

-- C. Valores por defecto para comanda y campos numéricos
ALTER TABLE detalleorden ALTER COLUMN estado_comanda SET DEFAULT 'pendiente';
UPDATE detalleorden SET estado_comanda = 'pendiente' WHERE estado_comanda IS NULL;

-- ----------------------------------------------------------------------------
-- 3. RESINCRONIZACIÓN DE TODAS LAS SECUENCIAS (SERIAL / BIGSERIAL)
-- Corrige colisiones: "duplicate key value violates unique constraint"
-- ----------------------------------------------------------------------------

SELECT setval(pg_get_serial_sequence('anulaciones', 'id'), COALESCE((SELECT MAX(id) FROM anulaciones), 1), (SELECT COUNT(*) > 0 FROM anulaciones));
SELECT setval(pg_get_serial_sequence('auditoria', 'id'), COALESCE((SELECT MAX(id) FROM auditoria), 1), (SELECT COUNT(*) > 0 FROM auditoria));
SELECT setval(pg_get_serial_sequence('cajas', 'id'), COALESCE((SELECT MAX(id) FROM cajas), 1), (SELECT COUNT(*) > 0 FROM cajas));
SELECT setval(pg_get_serial_sequence('categorias', 'id'), COALESCE((SELECT MAX(id) FROM categorias), 1), (SELECT COUNT(*) > 0 FROM categorias));
SELECT setval(pg_get_serial_sequence('detalleorden', 'id'), COALESCE((SELECT MAX(id) FROM detalleorden), 1), (SELECT COUNT(*) > 0 FROM detalleorden));
SELECT setval(pg_get_serial_sequence('facturaselectronicas', 'id'), COALESCE((SELECT MAX(id) FROM facturaselectronicas), 1), (SELECT COUNT(*) > 0 FROM facturaselectronicas));
SELECT setval(pg_get_serial_sequence('inventario', 'id'), COALESCE((SELECT MAX(id) FROM inventario), 1), (SELECT COUNT(*) > 0 FROM inventario));
SELECT setval(pg_get_serial_sequence('inventariomovimientos', 'id'), COALESCE((SELECT MAX(id) FROM inventariomovimientos), 1), (SELECT COUNT(*) > 0 FROM inventariomovimientos));
SELECT setval(pg_get_serial_sequence('inventariorecetas', 'id'), COALESCE((SELECT MAX(id) FROM inventariorecetas), 1), (SELECT COUNT(*) > 0 FROM inventariorecetas));
SELECT setval(pg_get_serial_sequence('mesas', 'id'), COALESCE((SELECT MAX(id) FROM mesas), 1), (SELECT COUNT(*) > 0 FROM mesas));
SELECT setval(pg_get_serial_sequence('movimientoscaja', 'id'), COALESCE((SELECT MAX(id) FROM movimientoscaja), 1), (SELECT COUNT(*) > 0 FROM movimientoscaja));
SELECT setval(pg_get_serial_sequence('negocios', 'id'), COALESCE((SELECT MAX(id) FROM negocios), 1), (SELECT COUNT(*) > 0 FROM negocios));
SELECT setval(pg_get_serial_sequence('ordenes', 'id'), COALESCE((SELECT MAX(id) FROM ordenes), 1), (SELECT COUNT(*) > 0 FROM ordenes));
SELECT setval(pg_get_serial_sequence('pagos', 'id'), COALESCE((SELECT MAX(id) FROM pagos), 1), (SELECT COUNT(*) > 0 FROM pagos));
SELECT setval(pg_get_serial_sequence('productos', 'id'), COALESCE((SELECT MAX(id) FROM productos), 1), (SELECT COUNT(*) > 0 FROM productos));
SELECT setval(pg_get_serial_sequence('tablemerges', 'id'), COALESCE((SELECT MAX(id) FROM tablemerges), 1), (SELECT COUNT(*) > 0 FROM tablemerges));
SELECT setval(pg_get_serial_sequence('usuarios', 'id'), COALESCE((SELECT MAX(id) FROM usuarios), 1), (SELECT COUNT(*) > 0 FROM usuarios));
SELECT setval(pg_get_serial_sequence('zonas', 'id'), COALESCE((SELECT MAX(id) FROM zonas), 1), (SELECT COUNT(*) > 0 FROM zonas));

-- ----------------------------------------------------------------------------
-- 4. VERIFICACIÓN DE INTEGRIDAD REFERENCIAL
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_orphans_ordenes INT;
  v_orphans_detalle INT;
BEGIN
  SELECT COUNT(*) INTO v_orphans_ordenes FROM ordenes WHERE mesa_id IS NOT NULL AND mesa_id NOT IN (SELECT id FROM mesas);
  SELECT COUNT(*) INTO v_orphans_detalle FROM detalleorden WHERE producto_id IS NOT NULL AND producto_id NOT IN (SELECT id FROM productos);
  
  IF v_orphans_ordenes > 0 OR v_orphans_detalle > 0 THEN
    RAISE EXCEPTION 'Existen huérfanos pendientes: ordenes(%), detalleorden(%)', v_orphans_ordenes, v_orphans_detalle;
  ELSE
    RAISE NOTICE 'Integridad referencial validada al 100 por ciento con éxito.';
  END IF;
END $$;

COMMIT;

