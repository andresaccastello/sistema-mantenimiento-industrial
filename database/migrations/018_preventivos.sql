-- database/migrations/018_preventivos.sql
-- Etapa PV1: Preventivos por calendario (D-021)
BEGIN;

-- 1. Zona horaria de la instalación: define "hoy" para los vencimientos
ALTER TABLE configuracion_sistema
    ADD COLUMN IF NOT EXISTS zona_horaria TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires';

-- 2. planes_mantenimiento, rehecha
-- 2.1 Si todavía tiene el formato viejo y tiene filas, la migración falla y no corrige nada.
DO $$
DECLARE
    v_ids TEXT;
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'planes_mantenimiento'
          AND column_name = 'criterio'
    ) THEN
        SELECT string_agg(t.id::TEXT, ', ' ORDER BY t.id)
        INTO v_ids
        FROM (SELECT id FROM planes_mantenimiento ORDER BY id LIMIT 20) t;

        IF v_ids IS NOT NULL THEN
            RAISE EXCEPTION 'Hay planes de mantenimiento con el formato viejo: %. Revisarlos antes de migrar.', v_ids;
        END IF;
    END IF;
END
$$;

-- 2.2 Columnas viejas, con sus restricciones y su índice
DROP INDEX IF EXISTS idx_planes_proxima_fecha;

ALTER TABLE planes_mantenimiento
    DROP CONSTRAINT IF EXISTS ck_planes_criterio,
    DROP CONSTRAINT IF EXISTS ck_planes_frecuencia;

ALTER TABLE planes_mantenimiento
    DROP COLUMN IF EXISTS criterio,
    DROP COLUMN IF EXISTS frecuencia_valor,
    DROP COLUMN IF EXISTS frecuencia_unidad,
    DROP COLUMN IF EXISTS proxima_fecha,
    DROP COLUMN IF EXISTS proximo_valor_objetivo,
    DROP COLUMN IF EXISTS observaciones;

-- 2.3 Columnas nuevas. La tabla llega vacía la primera vez (2.1), así que el NOT NULL sin
-- valor por omisión no falla; después, IF NOT EXISTS no la toca.
ALTER TABLE planes_mantenimiento
    ADD COLUMN IF NOT EXISTS anticipacion_dias INTEGER NOT NULL DEFAULT 7;

ALTER TABLE planes_mantenimiento
    ADD COLUMN IF NOT EXISTS creado_por_usuario_id BIGINT NOT NULL REFERENCES usuarios(id);

ALTER TABLE planes_mantenimiento
    DROP CONSTRAINT IF EXISTS ck_planes_anticipacion;

ALTER TABLE planes_mantenimiento
    ADD CONSTRAINT ck_planes_anticipacion
    CHECK (anticipacion_dias BETWEEN 0 AND 90);

-- 2.4 Un nombre por máquina, sin importar mayúsculas
CREATE UNIQUE INDEX IF NOT EXISTS uq_planes_maquina_nombre
    ON planes_mantenimiento (maquina_id, lower(nombre));

-- 3. plan_tareas: las tareas de un plan, cada una con su frecuencia
CREATE TABLE IF NOT EXISTS plan_tareas (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plan_id BIGINT NOT NULL REFERENCES planes_mantenimiento(id),
    orden INTEGER NOT NULL,
    accion VARCHAR(200) NOT NULL,
    detalle TEXT NULL,
    frecuencia_valor INTEGER NOT NULL,
    frecuencia_unidad VARCHAR(10) NOT NULL,
    primera_fecha DATE NOT NULL,
    repuesto_id BIGINT NULL REFERENCES repuestos(id),
    cantidad NUMERIC(14,3) NULL,
    proveedor_id BIGINT NULL REFERENCES proveedores(id),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_plan_tareas_orden UNIQUE (plan_id, orden)
);

ALTER TABLE plan_tareas
    DROP CONSTRAINT IF EXISTS ck_plan_tareas_unidad;

ALTER TABLE plan_tareas
    ADD CONSTRAINT ck_plan_tareas_unidad
    CHECK (frecuencia_unidad IN ('DIAS', 'SEMANAS', 'MESES', 'ANIOS'));

-- Hasta 10 años, según la unidad
ALTER TABLE plan_tareas
    DROP CONSTRAINT IF EXISTS ck_plan_tareas_frecuencia;

ALTER TABLE plan_tareas
    ADD CONSTRAINT ck_plan_tareas_frecuencia
    CHECK (
        frecuencia_valor >= 1
        AND frecuencia_valor <= CASE frecuencia_unidad
            WHEN 'DIAS' THEN 3650
            WHEN 'SEMANAS' THEN 520
            WHEN 'MESES' THEN 120
            WHEN 'ANIOS' THEN 10
        END
    );

ALTER TABLE plan_tareas
    DROP CONSTRAINT IF EXISTS ck_plan_tareas_cantidad;

ALTER TABLE plan_tareas
    ADD CONSTRAINT ck_plan_tareas_cantidad
    CHECK (cantidad IS NULL OR cantidad > 0);

-- La cantidad va si y solo si va el repuesto
ALTER TABLE plan_tareas
    DROP CONSTRAINT IF EXISTS ck_plan_tareas_repuesto_cantidad;

ALTER TABLE plan_tareas
    ADD CONSTRAINT ck_plan_tareas_repuesto_cantidad
    CHECK ((repuesto_id IS NULL) = (cantidad IS NULL));

-- 4. intervencion_tareas: las tareas de una intervención preventiva, copiadas del plan
CREATE TABLE IF NOT EXISTS intervencion_tareas (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    intervencion_id BIGINT NOT NULL REFERENCES intervenciones(id),
    plan_tarea_id BIGINT NOT NULL REFERENCES plan_tareas(id),
    orden INTEGER NOT NULL,
    accion VARCHAR(200) NOT NULL,
    detalle TEXT NULL,
    fecha_programada DATE NOT NULL,
    hecha BOOLEAN NOT NULL DEFAULT FALSE,
    hecha_por_usuario_id BIGINT NULL REFERENCES usuarios(id),
    hecha_en TIMESTAMPTZ NULL,
    observacion VARCHAR(500) NULL,
    CONSTRAINT uq_intervencion_tareas_tarea UNIQUE (intervencion_id, plan_tarea_id)
);

CREATE INDEX IF NOT EXISTS idx_intervencion_tareas_plan_tarea
    ON intervencion_tareas (plan_tarea_id);

-- Con hecha, van quién y cuándo; sin hecha, ninguno de los dos
ALTER TABLE intervencion_tareas
    DROP CONSTRAINT IF EXISTS ck_intervencion_tareas_hecha;

ALTER TABLE intervencion_tareas
    ADD CONSTRAINT ck_intervencion_tareas_hecha
    CHECK (
        (hecha AND hecha_por_usuario_id IS NOT NULL AND hecha_en IS NOT NULL)
        OR (NOT hecha AND hecha_por_usuario_id IS NULL AND hecha_en IS NULL)
    );

-- 5. Auditoría: CORRECCION_TAREA (la lista es la de la 007, que también la incluye)
ALTER TABLE intervencion_auditoria
    DROP CONSTRAINT IF EXISTS ck_intervencion_auditoria_evento;

ALTER TABLE intervencion_auditoria
    ADD CONSTRAINT ck_intervencion_auditoria_evento
    CHECK (tipo_evento IN (
        'ASIGNACION',
        'DESASIGNACION',
        'CORRECCION_FECHA',
        'CORRECCION_COSTO',
        'CORRECCION_TAREA',
        'ELIMINACION_LOGICA',
        'REAPERTURA',
        'EDICION',
        'OTRO'
    ));

-- 6. El estado de una tarea (D-021). Es el único lugar donde se calcula:
-- lo usan la API, la generación y las pruebas.
DROP VIEW IF EXISTS v_plan_tareas_estado;

CREATE VIEW v_plan_tareas_estado AS
SELECT
    t.*,
    z.hoy,
    u.ultima_ejecucion,
    p.proxima_fecha,
    (p.proxima_fecha - z.hoy) AS dias,
    ec.id AS intervencion_en_curso_id,
    ec.estado AS intervencion_en_curso_estado,
    CASE
        WHEN NOT t.activo OR NOT pl.activo OR NOT m.activo THEN 'INACTIVA'
        WHEN ec.id IS NOT NULL THEN 'EN_CURSO'
        WHEN p.proxima_fecha < z.hoy THEN 'VENCIDA'
        WHEN p.proxima_fecha <= z.hoy + pl.anticipacion_dias THEN 'PROXIMA'
        ELSE 'AL_DIA'
    END AS estado
FROM plan_tareas t
JOIN planes_mantenimiento pl ON pl.id = t.plan_id
JOIN maquinas m ON m.id = pl.maquina_id
CROSS JOIN (
    SELECT zh.zona, (now() AT TIME ZONE zh.zona)::date AS hoy
    FROM (
        SELECT COALESCE(
            (SELECT zona_horaria FROM configuracion_sistema WHERE id = 1),
            'America/Argentina/Buenos_Aires'
        ) AS zona
    ) zh
) z
-- La última ejecución: la fecha local de finalización de la última intervención
-- finalizada, no eliminada, con la tarea hecha
LEFT JOIN LATERAL (
    SELECT max((i.fecha_finalizacion AT TIME ZONE z.zona)::date) AS ultima_ejecucion
    FROM intervencion_tareas it
    JOIN intervenciones i ON i.id = it.intervencion_id
    WHERE it.plan_tarea_id = t.id
      AND it.hecha
      AND i.estado = 'FINALIZADA'
      AND i.eliminado_en IS NULL
) u ON TRUE
-- La próxima fecha: sin ejecuciones, la primera; con ellas, la última más la frecuencia
CROSS JOIN LATERAL (
    SELECT CASE
        WHEN u.ultima_ejecucion IS NULL THEN t.primera_fecha
        ELSE (
            u.ultima_ejecucion + CASE t.frecuencia_unidad
                WHEN 'DIAS' THEN make_interval(days => t.frecuencia_valor)
                WHEN 'SEMANAS' THEN make_interval(weeks => t.frecuencia_valor)
                WHEN 'MESES' THEN make_interval(months => t.frecuencia_valor)
                WHEN 'ANIOS' THEN make_interval(years => t.frecuencia_valor)
            END
        )::date
    END AS proxima_fecha
) p
-- La intervención en curso con la tarea: si hay más de una, la de menor id
LEFT JOIN LATERAL (
    SELECT i.id, i.estado
    FROM intervencion_tareas it
    JOIN intervenciones i ON i.id = it.intervencion_id
    WHERE it.plan_tarea_id = t.id
      AND i.eliminado_en IS NULL
      AND i.estado IN ('PENDIENTE', 'EN_PROCESO', 'EN_ESPERA_REPUESTOS')
    ORDER BY i.id
    LIMIT 1
) ec ON TRUE;

COMMIT;
