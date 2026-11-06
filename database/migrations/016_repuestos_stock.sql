-- database/migrations/016_repuestos_stock.sql
-- Etapa R1: Repuestos, stock y pedidos
BEGIN;

-- 1. Tabla proveedores
CREATE TABLE IF NOT EXISTS proveedores (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    contacto VARCHAR(150) NULL,
    telefono VARCHAR(40) NULL,
    email VARCHAR(254) NULL,
    notas TEXT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_proveedores_email CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_proveedores_nombre
    ON proveedores (lower(trim(nombre)));

-- 2. Columnas y restricciones en repuestos
ALTER TABLE repuestos
    ADD COLUMN IF NOT EXISTS codigo VARCHAR(40) NULL;

ALTER TABLE repuestos
    ADD COLUMN IF NOT EXISTS unidad VARCHAR(20) NOT NULL DEFAULT 'unidad';

ALTER TABLE repuestos
    ADD COLUMN IF NOT EXISTS lleva_stock BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE repuestos
    ADD COLUMN IF NOT EXISTS stock_minimo NUMERIC(14,3) NULL;

ALTER TABLE repuestos
    ADD COLUMN IF NOT EXISTS proveedor_id BIGINT NULL REFERENCES proveedores(id);

ALTER TABLE repuestos
    ADD COLUMN IF NOT EXISTS ubicacion VARCHAR(100) NULL;

ALTER TABLE repuestos
    ADD COLUMN IF NOT EXISTS descripcion TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_repuestos_codigo
    ON repuestos (upper(trim(codigo)))
    WHERE codigo IS NOT NULL;

ALTER TABLE repuestos
    DROP CONSTRAINT IF EXISTS ck_repuestos_unidad_no_vacia;

ALTER TABLE repuestos
    ADD CONSTRAINT ck_repuestos_unidad_no_vacia
    CHECK (trim(unidad) <> '');

ALTER TABLE repuestos
    DROP CONSTRAINT IF EXISTS ck_repuestos_stock_minimo;

ALTER TABLE repuestos
    ADD CONSTRAINT ck_repuestos_stock_minimo
    CHECK (stock_minimo IS NULL OR stock_minimo >= 0);

ALTER TABLE repuestos
    DROP CONSTRAINT IF EXISTS ck_repuestos_lleva_stock;

ALTER TABLE repuestos
    ADD CONSTRAINT ck_repuestos_lleva_stock
    CHECK (lleva_stock OR (cantidad_disponible = 0 AND stock_minimo IS NULL));

COMMENT ON COLUMN repuestos.proveedor IS 'Columna en desuso, reemplazada por proveedor_id';

-- 3. Tabla repuesto_costos
CREATE TABLE IF NOT EXISTS repuesto_costos (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    repuesto_id BIGINT NOT NULL REFERENCES repuestos(id) ON DELETE CASCADE,
    costo_unitario NUMERIC(14,2) NOT NULL,
    origen VARCHAR(12) NOT NULL,
    registrado_por_usuario_id BIGINT NULL REFERENCES usuarios(id),
    registrado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_repuesto_costos_costo CHECK (costo_unitario >= 0),
    CONSTRAINT ck_repuesto_costos_origen CHECK (origen IN ('MIGRACION', 'ALTA', 'EDICION', 'INGRESO', 'CONSUMO')),
    CONSTRAINT ck_repuesto_costos_usuario CHECK (registrado_por_usuario_id IS NOT NULL OR origen = 'MIGRACION')
);

CREATE INDEX IF NOT EXISTS idx_repuesto_costos_repuesto_fecha
    ON repuesto_costos (repuesto_id, registrado_en);

-- 4. Columnas y restricciones en movimientos_stock
ALTER TABLE movimientos_stock
    ADD COLUMN IF NOT EXISTS delta NUMERIC(14,3) NULL;

ALTER TABLE movimientos_stock
    ADD COLUMN IF NOT EXISTS stock_resultante NUMERIC(14,3) NULL;

ALTER TABLE movimientos_stock
    ADD COLUMN IF NOT EXISTS proveedor_id BIGINT NULL REFERENCES proveedores(id);

ALTER TABLE movimientos_stock
    ADD COLUMN IF NOT EXISTS comprobante VARCHAR(60) NULL;

ALTER TABLE movimientos_stock
    DROP CONSTRAINT IF EXISTS ck_movimientos_stock_tipo;

ALTER TABLE movimientos_stock
    ADD CONSTRAINT ck_movimientos_stock_tipo
    CHECK (tipo IN ('INGRESO', 'EGRESO', 'AJUSTE', 'DEVOLUCION'));

ALTER TABLE movimientos_stock
    DROP CONSTRAINT IF EXISTS ck_movimientos_stock_resultante;

ALTER TABLE movimientos_stock
    ADD CONSTRAINT ck_movimientos_stock_resultante
    CHECK (stock_resultante IS NULL OR stock_resultante >= 0);

ALTER TABLE movimientos_stock
    DROP CONSTRAINT IF EXISTS ck_movimientos_stock_delta_resultante;

ALTER TABLE movimientos_stock
    ADD CONSTRAINT ck_movimientos_stock_delta_resultante
    CHECK ((delta IS NULL AND stock_resultante IS NULL) OR (delta IS NOT NULL AND stock_resultante IS NOT NULL));

ALTER TABLE movimientos_stock
    DROP CONSTRAINT IF EXISTS ck_movimientos_stock_delta_tipo;

ALTER TABLE movimientos_stock
    ADD CONSTRAINT ck_movimientos_stock_delta_tipo
    CHECK (
        delta IS NULL
        OR (tipo IN ('INGRESO', 'DEVOLUCION') AND delta = cantidad)
        OR (tipo = 'EGRESO' AND delta = -cantidad)
        OR (tipo = 'AJUSTE' AND abs(delta) = cantidad)
    );

CREATE INDEX IF NOT EXISTS idx_movimientos_stock_intervencion_id
    ON movimientos_stock (intervencion_id);

-- 5. Columnas y restricciones en intervencion_repuestos
ALTER TABLE intervencion_repuestos
    ADD COLUMN IF NOT EXISTS registrado_por_usuario_id BIGINT NULL REFERENCES usuarios(id);

ALTER TABLE intervencion_repuestos
    ADD COLUMN IF NOT EXISTS observacion TEXT NULL;

ALTER TABLE intervencion_repuestos
    ADD COLUMN IF NOT EXISTS movimiento_id BIGINT NULL REFERENCES movimientos_stock(id);

ALTER TABLE intervencion_repuestos
    ADD COLUMN IF NOT EXISTS anulado_en TIMESTAMPTZ NULL;

ALTER TABLE intervencion_repuestos
    ADD COLUMN IF NOT EXISTS anulado_por_usuario_id BIGINT NULL REFERENCES usuarios(id);

ALTER TABLE intervencion_repuestos
    ADD COLUMN IF NOT EXISTS motivo_anulacion TEXT NULL;

ALTER TABLE intervencion_repuestos
    ADD COLUMN IF NOT EXISTS devolucion_movimiento_id BIGINT NULL REFERENCES movimientos_stock(id);

ALTER TABLE intervencion_repuestos
    DROP CONSTRAINT IF EXISTS ck_intervencion_repuestos_anulacion;

ALTER TABLE intervencion_repuestos
    ADD CONSTRAINT ck_intervencion_repuestos_anulacion
    CHECK (
        (anulado_en IS NULL AND anulado_por_usuario_id IS NULL AND motivo_anulacion IS NULL)
        OR (anulado_en IS NOT NULL AND anulado_por_usuario_id IS NOT NULL AND motivo_anulacion IS NOT NULL)
    );

-- 6. Tabla pedidos_repuesto
CREATE TABLE IF NOT EXISTS pedidos_repuesto (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    intervencion_id BIGINT NOT NULL REFERENCES intervenciones(id) ON DELETE RESTRICT,
    repuesto_id BIGINT NULL REFERENCES repuestos(id),
    descripcion VARCHAR(200) NULL,
    cantidad NUMERIC(14,3) NOT NULL,
    proveedor_id BIGINT NULL REFERENCES proveedores(id),
    estado VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE',
    pedido_en DATE NULL,
    esperado_para DATE NULL,
    recibido_en TIMESTAMPTZ NULL,
    observacion TEXT NULL,
    motivo_cancelacion TEXT NULL,
    movimiento_id BIGINT NULL REFERENCES movimientos_stock(id),
    creado_por_usuario_id BIGINT NOT NULL REFERENCES usuarios(id),
    actualizado_por_usuario_id BIGINT NULL REFERENCES usuarios(id),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_pedidos_repuesto_cantidad CHECK (cantidad > 0),
    CONSTRAINT ck_pedidos_repuesto_estado CHECK (estado IN ('PENDIENTE', 'PEDIDO', 'RECIBIDO', 'CANCELADO')),
    CONSTRAINT ck_pedidos_repuesto_item CHECK (repuesto_id IS NOT NULL OR (descripcion IS NOT NULL AND length(trim(descripcion)) >= 3)),
    CONSTRAINT ck_pedidos_repuesto_transiciones CHECK (
        (estado <> 'PEDIDO' OR pedido_en IS NOT NULL) AND
        (estado <> 'RECIBIDO' OR recibido_en IS NOT NULL) AND
        (estado <> 'CANCELADO' OR (motivo_cancelacion IS NOT NULL AND length(trim(motivo_cancelacion)) > 0))
    ),
    CONSTRAINT ck_pedidos_repuesto_fechas CHECK (esperado_para IS NULL OR pedido_en IS NULL OR esperado_para >= pedido_en)
);

CREATE INDEX IF NOT EXISTS idx_pedidos_repuesto_intervencion_id
    ON pedidos_repuesto (intervencion_id);

CREATE INDEX IF NOT EXISTS idx_pedidos_repuesto_pendientes_pedidos
    ON pedidos_repuesto (estado)
    WHERE estado IN ('PENDIENTE', 'PEDIDO');

-- 7. Datos que ya existen (Backfill idempotente)
-- 7.1 Proveedores desde el texto viejo
INSERT INTO proveedores (nombre, creado_en, actualizado_en)
SELECT DISTINCT ON (lower(trim(proveedor))) trim(proveedor), NOW(), NOW()
FROM repuestos
WHERE proveedor IS NOT NULL AND trim(proveedor) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM proveedores p WHERE lower(trim(p.nombre)) = lower(trim(repuestos.proveedor))
  )
ORDER BY lower(trim(proveedor)), id;

UPDATE repuestos r
SET proveedor_id = p.id
FROM proveedores p
WHERE r.proveedor IS NOT NULL AND trim(r.proveedor) <> ''
  AND r.proveedor_id IS NULL
  AND lower(trim(p.nombre)) = lower(trim(r.proveedor));

-- 7.2 Historial inicial de costos
INSERT INTO repuesto_costos (repuesto_id, costo_unitario, origen, registrado_por_usuario_id, registrado_en)
SELECT r.id, r.costo_unitario, 'MIGRACION', NULL, r.actualizado_en
FROM repuestos r
WHERE NOT EXISTS (
  SELECT 1 FROM repuesto_costos rc WHERE rc.repuesto_id = r.id
);

COMMIT;
