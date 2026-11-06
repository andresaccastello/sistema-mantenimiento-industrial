-- database/migrations/013_datos_maquina.sql
-- Etapa F3a: Datos de la máquina (criticidades, tipos de equipo, plantas y modelo)
BEGIN;

-- 1.1 Tabla criticidades
CREATE TABLE IF NOT EXISTS criticidades (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo VARCHAR(30) NOT NULL UNIQUE,
    nombre VARCHAR(60) NOT NULL UNIQUE,
    orden SMALLINT NOT NULL UNIQUE,
    prioridad_alta BOOLEAN NOT NULL DEFAULT FALSE,
    por_omision BOOLEAN NOT NULL DEFAULT FALSE,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT ck_criticidades_orden CHECK (orden > 0),
    CONSTRAINT ck_criticidades_omision_activo CHECK (NOT por_omision OR activo)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_criticidades_por_omision
    ON criticidades (por_omision)
    WHERE por_omision;

INSERT INTO criticidades (codigo, nombre, orden, prioridad_alta, por_omision, activo)
VALUES
    ('ALTA', 'Alta', 1, TRUE, FALSE, TRUE),
    ('MEDIA', 'Media', 2, FALSE, TRUE, TRUE),
    ('BAJA', 'Baja', 3, FALSE, FALSE, TRUE)
ON CONFLICT DO NOTHING;

-- 1.2 Tabla tipos_equipo
CREATE TABLE IF NOT EXISTS tipos_equipo (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo VARCHAR(30) NOT NULL UNIQUE,
    nombre VARCHAR(60) NOT NULL UNIQUE,
    orden SMALLINT NOT NULL UNIQUE,
    por_omision BOOLEAN NOT NULL DEFAULT FALSE,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT ck_tipos_equipo_orden CHECK (orden > 0),
    CONSTRAINT ck_tipos_equipo_omision_activo CHECK (NOT por_omision OR activo)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tipos_equipo_por_omision
    ON tipos_equipo (por_omision)
    WHERE por_omision;

INSERT INTO tipos_equipo (codigo, nombre, orden, por_omision, activo)
VALUES
    ('MAQUINA', 'Máquina', 1, TRUE, TRUE),
    ('VEHICULO', 'Vehículo', 2, FALSE, TRUE),
    ('INSTALACION', 'Instalación', 3, FALSE, TRUE),
    ('HERRAMIENTA', 'Herramienta menor', 4, FALSE, TRUE)
ON CONFLICT DO NOTHING;

-- 1.3 Tabla plantas
CREATE TABLE IF NOT EXISTS plantas (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    descripcion TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1.4 sectores.planta_id
ALTER TABLE sectores
    ADD COLUMN IF NOT EXISTS planta_id BIGINT NULL REFERENCES plantas(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_sectores_planta
    ON sectores (planta_id);

-- 1.5 maquinas.criticidad_id y maquinas.tipo_equipo_id
CREATE OR REPLACE FUNCTION fn_criticidad_por_omision()
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
    SELECT id FROM criticidades WHERE por_omision = TRUE AND activo = TRUE LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION fn_tipo_equipo_por_omision()
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
    SELECT id FROM tipos_equipo WHERE por_omision = TRUE AND activo = TRUE LIMIT 1;
$$;

ALTER TABLE maquinas
    ADD COLUMN IF NOT EXISTS criticidad_id BIGINT REFERENCES criticidades(id) ON DELETE RESTRICT;

UPDATE maquinas
SET criticidad_id = fn_criticidad_por_omision()
WHERE criticidad_id IS NULL;

ALTER TABLE maquinas
    ALTER COLUMN criticidad_id SET DEFAULT fn_criticidad_por_omision(),
    ALTER COLUMN criticidad_id SET NOT NULL;

ALTER TABLE maquinas
    ADD COLUMN IF NOT EXISTS tipo_equipo_id BIGINT REFERENCES tipos_equipo(id) ON DELETE RESTRICT;

UPDATE maquinas
SET tipo_equipo_id = fn_tipo_equipo_por_omision()
WHERE tipo_equipo_id IS NULL;

ALTER TABLE maquinas
    ALTER COLUMN tipo_equipo_id SET DEFAULT fn_tipo_equipo_por_omision(),
    ALTER COLUMN tipo_equipo_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_maquinas_criticidad
    ON maquinas (criticidad_id);

CREATE INDEX IF NOT EXISTS idx_maquinas_tipo_equipo
    ON maquinas (tipo_equipo_id);

-- 1.6 maquinas.tipo pasa a llamarse modelo
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'maquinas'
          AND column_name = 'tipo'
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'maquinas'
          AND column_name = 'modelo'
    ) THEN
        ALTER TABLE maquinas RENAME COLUMN tipo TO modelo;
    END IF;
END $$;

COMMIT;

