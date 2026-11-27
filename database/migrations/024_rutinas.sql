-- database/migrations/024_rutinas.sql
-- Etapa RT1: tareas de rutina del operario, diarias y semanales (D-033)
BEGIN;

-- 1.1 Las rutinas de cada máquina. No se borran: se dan de baja.
CREATE TABLE IF NOT EXISTS rutinas (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    maquina_id BIGINT NOT NULL REFERENCES maquinas(id),
    descripcion VARCHAR(200) NOT NULL,
    frecuencia VARCHAR(7) NOT NULL,
    incluye_sabado BOOLEAN NOT NULL DEFAULT FALSE,
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    vigente_desde DATE NOT NULL,
    baja_en DATE NULL,
    creado_por_usuario_id BIGINT NOT NULL REFERENCES usuarios(id),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rutinas DROP CONSTRAINT IF EXISTS ck_rutinas_descripcion;
ALTER TABLE rutinas
    ADD CONSTRAINT ck_rutinas_descripcion CHECK (btrim(descripcion) <> '');

ALTER TABLE rutinas DROP CONSTRAINT IF EXISTS ck_rutinas_frecuencia;
ALTER TABLE rutinas
    ADD CONSTRAINT ck_rutinas_frecuencia CHECK (frecuencia IN ('DIARIA', 'SEMANAL'));

ALTER TABLE rutinas DROP CONSTRAINT IF EXISTS ck_rutinas_incluye_sabado;
ALTER TABLE rutinas
    ADD CONSTRAINT ck_rutinas_incluye_sabado CHECK (frecuencia = 'DIARIA' OR NOT incluye_sabado);

ALTER TABLE rutinas DROP CONSTRAINT IF EXISTS ck_rutinas_baja;
ALTER TABLE rutinas
    ADD CONSTRAINT ck_rutinas_baja CHECK (activa = (baja_en IS NULL));

-- Una descripción no se repite entre las activas de una máquina
CREATE UNIQUE INDEX IF NOT EXISTS uq_rutinas_maquina_descripcion
    ON rutinas (maquina_id, lower(btrim(descripcion)))
    WHERE activa;

CREATE INDEX IF NOT EXISTS idx_rutinas_maquina ON rutinas (maquina_id);

-- 1.2 Una fila por cada vez que se hizo
CREATE TABLE IF NOT EXISTS rutina_registros (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rutina_id BIGINT NOT NULL REFERENCES rutinas(id),
    periodo DATE NOT NULL,
    usuario_id BIGINT NOT NULL REFERENCES usuarios(id),
    hecha_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    nota VARCHAR(500) NULL
);

ALTER TABLE rutina_registros DROP CONSTRAINT IF EXISTS uq_rutina_registros_periodo;
ALTER TABLE rutina_registros
    ADD CONSTRAINT uq_rutina_registros_periodo UNIQUE (rutina_id, periodo);

-- 1.3 Las reglas, en un solo lugar: las usan la API, el reporte y las pruebas
CREATE OR REPLACE FUNCTION periodo_rutina(p_frecuencia VARCHAR, p_fecha DATE) RETURNS DATE
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_frecuencia = 'SEMANAL' THEN p_fecha - (EXTRACT(ISODOW FROM p_fecha)::int - 1)
        ELSE p_fecha
    END
$$;

CREATE OR REPLACE FUNCTION rutina_corresponde(p_frecuencia VARCHAR, p_incluye_sabado BOOLEAN, p_fecha DATE)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_frecuencia = 'SEMANAL' THEN TRUE
        WHEN EXTRACT(ISODOW FROM p_fecha) <= 5 THEN TRUE
        WHEN EXTRACT(ISODOW FROM p_fecha) = 6 THEN COALESCE(p_incluye_sabado, FALSE)
        ELSE FALSE
    END
$$;

-- 1.2 En una semanal, el período es un lunes: trigger, para que valga también fuera de la API
CREATE OR REPLACE FUNCTION trg_fn_rutina_registros_periodo() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_frecuencia VARCHAR(7);
BEGIN
    SELECT frecuencia INTO v_frecuencia FROM rutinas WHERE id = NEW.rutina_id;
    IF v_frecuencia = 'SEMANAL' AND NEW.periodo <> periodo_rutina(v_frecuencia, NEW.periodo) THEN
        RAISE EXCEPTION 'El período de una rutina semanal tiene que ser un lunes'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'ck_rutina_registros_periodo_lunes';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rutina_registros_periodo ON rutina_registros;
CREATE TRIGGER trg_rutina_registros_periodo
    BEFORE INSERT OR UPDATE OF rutina_id, periodo ON rutina_registros
    FOR EACH ROW EXECUTE FUNCTION trg_fn_rutina_registros_periodo();

-- 1.4 El permiso nuevo
INSERT INTO permisos (codigo, nombre, descripcion, usa_alcance)
VALUES (
    'RUTINAS_REALIZAR',
    'Marcar tareas de rutina',
    'Permite marcar como hechas las tareas de rutina de las máquinas',
    TRUE
)
ON CONFLICT (codigo) DO UPDATE
SET nombre = EXCLUDED.nombre,
    descripcion = EXCLUDED.descripcion,
    usa_alcance = EXCLUDED.usa_alcance;

INSERT INTO perfil_permiso (perfil_id, permiso_id, alcance)
SELECT p.id, pe.id, x.alcance
FROM (VALUES
    ('ADMINISTRADOR', 'TODAS'),
    ('RESPONSABLE_MANTENIMIENTO', 'TODAS'),
    ('OPERARIO', 'SECTORES')
) AS x(perfil, alcance)
JOIN perfiles p ON p.nombre = x.perfil
JOIN permisos pe ON pe.codigo = 'RUTINAS_REALIZAR'
ON CONFLICT (perfil_id, permiso_id) DO NOTHING;

COMMIT;
