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

-- 3.1 La vista usa t.*: se saca antes de tocar las columnas de plan_tareas, y se vuelve
-- a crear al final (sección 7)
DROP VIEW IF EXISTS v_plan_tareas_estado;

-- 3.2 plan_tarea_repuestos: los repuestos previstos de una tarea (D-022)
CREATE TABLE IF NOT EXISTS plan_tarea_repuestos (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plan_tarea_id BIGINT NOT NULL REFERENCES plan_tareas(id),
    repuesto_id BIGINT NOT NULL REFERENCES repuestos(id),
    cantidad NUMERIC(14,3) NOT NULL,
    orden INTEGER NOT NULL,
    CONSTRAINT uq_plan_tarea_repuestos_repuesto UNIQUE (plan_tarea_id, repuesto_id)
);

ALTER TABLE plan_tarea_repuestos
    DROP CONSTRAINT IF EXISTS ck_plan_tarea_repuestos_cantidad;

ALTER TABLE plan_tarea_repuestos
    ADD CONSTRAINT ck_plan_tarea_repuestos_cantidad
    CHECK (cantidad > 0);

-- 3.3 Con el formato de la PV1: el repuesto de cada tarea pasa a la lista, con orden 1,
-- y se sacan las dos columnas y sus restricciones
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'plan_tareas'
          AND column_name = 'repuesto_id'
    ) THEN
        INSERT INTO plan_tarea_repuestos (plan_tarea_id, repuesto_id, cantidad, orden)
        SELECT t.id, t.repuesto_id, t.cantidad, 1
        FROM plan_tareas t
        WHERE t.repuesto_id IS NOT NULL
        ON CONFLICT (plan_tarea_id, repuesto_id) DO NOTHING;

        ALTER TABLE plan_tareas
            DROP CONSTRAINT IF EXISTS ck_plan_tareas_cantidad,
            DROP CONSTRAINT IF EXISTS ck_plan_tareas_repuesto_cantidad;

        ALTER TABLE plan_tareas
            DROP COLUMN repuesto_id,
            DROP COLUMN IF EXISTS cantidad;
    END IF;
END
$$;

-- 3.4 medidores: los medidores de una máquina (D-023)
CREATE TABLE IF NOT EXISTS medidores (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    maquina_id BIGINT NOT NULL REFERENCES maquinas(id),
    nombre VARCHAR(60) NOT NULL,
    unidad VARCHAR(20) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_por_usuario_id BIGINT NOT NULL REFERENCES usuarios(id),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Un nombre por máquina, sin importar mayúsculas
CREATE UNIQUE INDEX IF NOT EXISTS uq_medidores_maquina_nombre
    ON medidores (maquina_id, lower(nombre));

-- 3.5 plan_tareas: vence por fecha, por uso o por las dos (D-023)
ALTER TABLE plan_tareas
    ALTER COLUMN frecuencia_valor DROP NOT NULL,
    ALTER COLUMN frecuencia_unidad DROP NOT NULL,
    ALTER COLUMN primera_fecha DROP NOT NULL;

ALTER TABLE plan_tareas
    ADD COLUMN IF NOT EXISTS medidor_id BIGINT NULL REFERENCES medidores(id),
    ADD COLUMN IF NOT EXISTS uso_cada NUMERIC(14,2) NULL,
    ADD COLUMN IF NOT EXISTS uso_primera NUMERIC(14,2) NULL,
    ADD COLUMN IF NOT EXISTS uso_anticipacion NUMERIC(14,2) NULL;

ALTER TABLE plan_tareas
    DROP CONSTRAINT IF EXISTS ck_plan_tareas_fecha_completa,
    DROP CONSTRAINT IF EXISTS ck_plan_tareas_uso_completo,
    DROP CONSTRAINT IF EXISTS ck_plan_tareas_criterio,
    DROP CONSTRAINT IF EXISTS ck_plan_tareas_uso_cada,
    DROP CONSTRAINT IF EXISTS ck_plan_tareas_uso_primera,
    DROP CONSTRAINT IF EXISTS ck_plan_tareas_uso_anticipacion;

ALTER TABLE plan_tareas
    ADD CONSTRAINT ck_plan_tareas_fecha_completa
    CHECK (num_nonnulls(frecuencia_valor, frecuencia_unidad, primera_fecha) IN (0, 3)),
    ADD CONSTRAINT ck_plan_tareas_uso_completo
    CHECK (num_nonnulls(medidor_id, uso_cada, uso_primera, uso_anticipacion) IN (0, 4)),
    ADD CONSTRAINT ck_plan_tareas_criterio
    CHECK (primera_fecha IS NOT NULL OR medidor_id IS NOT NULL),
    ADD CONSTRAINT ck_plan_tareas_uso_cada
    CHECK (uso_cada > 0),
    ADD CONSTRAINT ck_plan_tareas_uso_primera
    CHECK (uso_primera >= 0),
    ADD CONSTRAINT ck_plan_tareas_uso_anticipacion
    CHECK (uso_anticipacion >= 0 AND uso_anticipacion <= uso_cada);

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

-- 4.1 intervencion_tarea_repuestos: los previstos de una tarea en la intervención (D-022)
CREATE TABLE IF NOT EXISTS intervencion_tarea_repuestos (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    intervencion_tarea_id BIGINT NOT NULL REFERENCES intervencion_tareas(id),
    repuesto_id BIGINT NOT NULL REFERENCES repuestos(id),
    cantidad_prevista NUMERIC(14,3) NOT NULL,
    orden INTEGER NOT NULL,
    consumo_id BIGINT NULL REFERENCES intervencion_repuestos(id),
    CONSTRAINT uq_intervencion_tarea_repuestos_repuesto UNIQUE (intervencion_tarea_id, repuesto_id),
    CONSTRAINT uq_intervencion_tarea_repuestos_consumo UNIQUE (consumo_id)
);

ALTER TABLE intervencion_tarea_repuestos
    DROP CONSTRAINT IF EXISTS ck_intervencion_tarea_repuestos_cantidad;

ALTER TABLE intervencion_tarea_repuestos
    ADD CONSTRAINT ck_intervencion_tarea_repuestos_cantidad
    CHECK (cantidad_prevista > 0);

-- 4.2 intervencion_tareas: el medidor, copiado del plan, y su valor al hacer la tarea (D-023)
ALTER TABLE intervencion_tareas
    ALTER COLUMN fecha_programada DROP NOT NULL;

ALTER TABLE intervencion_tareas
    ADD COLUMN IF NOT EXISTS medidor_id BIGINT NULL REFERENCES medidores(id),
    ADD COLUMN IF NOT EXISTS uso_programado NUMERIC(14,2) NULL,
    ADD COLUMN IF NOT EXISTS valor_medidor NUMERIC(14,2) NULL;

ALTER TABLE intervencion_tareas
    DROP CONSTRAINT IF EXISTS ck_intervencion_tareas_uso_programado,
    DROP CONSTRAINT IF EXISTS ck_intervencion_tareas_valor_medidor,
    DROP CONSTRAINT IF EXISTS ck_intervencion_tareas_criterio;

ALTER TABLE intervencion_tareas
    ADD CONSTRAINT ck_intervencion_tareas_uso_programado
    CHECK ((uso_programado IS NOT NULL) = (medidor_id IS NOT NULL)),
    ADD CONSTRAINT ck_intervencion_tareas_valor_medidor
    CHECK ((valor_medidor IS NOT NULL) = (hecha AND medidor_id IS NOT NULL)),
    ADD CONSTRAINT ck_intervencion_tareas_criterio
    CHECK (fecha_programada IS NOT NULL OR medidor_id IS NOT NULL);

-- 4.3 lecturas_medidor: acumuladas; una mal cargada se anula, nada se borra (D-023)
CREATE TABLE IF NOT EXISTS lecturas_medidor (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    medidor_id BIGINT NOT NULL REFERENCES medidores(id),
    valor NUMERIC(14,2) NOT NULL,
    registrada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    registrada_por_usuario_id BIGINT NOT NULL REFERENCES usuarios(id),
    origen VARCHAR(10) NOT NULL,
    intervencion_tarea_id BIGINT NULL REFERENCES intervencion_tareas(id),
    observacion VARCHAR(200) NULL,
    anulada_en TIMESTAMPTZ NULL,
    anulada_por_usuario_id BIGINT NULL REFERENCES usuarios(id),
    motivo_anulacion TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_lecturas_medidor_vigentes
    ON lecturas_medidor (medidor_id, valor DESC, id DESC)
    WHERE anulada_en IS NULL;

ALTER TABLE lecturas_medidor
    DROP CONSTRAINT IF EXISTS ck_lecturas_medidor_valor,
    DROP CONSTRAINT IF EXISTS ck_lecturas_medidor_origen,
    DROP CONSTRAINT IF EXISTS ck_lecturas_medidor_tarea,
    DROP CONSTRAINT IF EXISTS ck_lecturas_medidor_anulacion;

ALTER TABLE lecturas_medidor
    ADD CONSTRAINT ck_lecturas_medidor_valor
    CHECK (valor >= 0),
    ADD CONSTRAINT ck_lecturas_medidor_origen
    CHECK (origen IN ('MANUAL', 'TAREA')),
    ADD CONSTRAINT ck_lecturas_medidor_tarea
    CHECK ((origen = 'TAREA') = (intervencion_tarea_id IS NOT NULL)),
    ADD CONSTRAINT ck_lecturas_medidor_anulacion
    CHECK (num_nonnulls(anulada_en, anulada_por_usuario_id, motivo_anulacion) IN (0, 3));

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

-- 5.1 Permiso MAQUINAS_REGISTRAR_LECTURAS (D-023)
INSERT INTO permisos (codigo, nombre, descripcion, usa_alcance)
VALUES (
    'MAQUINAS_REGISTRAR_LECTURAS',
    'Cargar lecturas de medidores',
    'Permite cargar las lecturas de los medidores de las máquinas',
    FALSE
)
ON CONFLICT (codigo) DO UPDATE
SET nombre = EXCLUDED.nombre,
    descripcion = EXCLUDED.descripcion,
    usa_alcance = EXCLUDED.usa_alcance;

INSERT INTO perfil_permiso (perfil_id, permiso_id, alcance)
SELECT p.id, pe.id, 'TODAS'
FROM perfiles p
JOIN permisos pe ON pe.codigo = 'MAQUINAS_REGISTRAR_LECTURAS'
WHERE p.nombre IN ('ADMINISTRADOR', 'RESPONSABLE_MANTENIMIENTO', 'OPERARIO')
ON CONFLICT (perfil_id, permiso_id) DO NOTHING;

-- 6. "Hoy" de la instalación (D-021, punto 6), en un solo lugar: lo usan la vista y la API
CREATE OR REPLACE FUNCTION hoy_instalacion() RETURNS DATE
LANGUAGE sql STABLE
AS $$
    SELECT (now() AT TIME ZONE COALESCE(
        (SELECT zona_horaria FROM configuracion_sistema WHERE id = 1),
        'America/Argentina/Buenos_Aires'
    ))::date
$$;

-- 7. El estado de una tarea (D-021). Es el único lugar donde se calcula:
-- lo usan la API, la generación y las pruebas. Se sacó en la 3.1.
CREATE VIEW v_plan_tareas_estado AS
SELECT
    t.*,
    z.hoy,
    u.ultima_ejecucion,
    p.proxima_fecha,
    (p.proxima_fecha - z.hoy) AS dias,
    ec.id AS intervencion_en_curso_id,
    ec.estado AS intervencion_en_curso_estado,
    la.valor AS lectura_actual,
    la.registrada_en AS lectura_actual_en,
    uu.ultimo_uso,
    pu.proximo_uso,
    (pu.proximo_uso - la.valor) AS faltan_uso,
    eu.estado_uso,
    ef.estado_fecha,
    CASE
        WHEN NOT t.activo OR NOT pl.activo OR NOT m.activo OR md.activo IS FALSE THEN 'INACTIVA'
        WHEN ec.id IS NOT NULL THEN 'EN_CURSO'
        WHEN ef.estado_fecha = 'VENCIDA' OR eu.estado_uso = 'VENCIDA' THEN 'VENCIDA'
        WHEN ef.estado_fecha = 'PROXIMA' OR eu.estado_uso = 'PROXIMA' THEN 'PROXIMA'
        WHEN eu.estado_uso = 'SIN_LECTURA' THEN 'SIN_LECTURA'
        ELSE 'AL_DIA'
    END AS estado
FROM plan_tareas t
JOIN planes_mantenimiento pl ON pl.id = t.plan_id
JOIN maquinas m ON m.id = pl.maquina_id
LEFT JOIN medidores md ON md.id = t.medidor_id
CROSS JOIN (
    -- La zona, para pasar la finalización a fecha local; "hoy", de hoy_instalacion()
    SELECT COALESCE(
        (SELECT zona_horaria FROM configuracion_sistema WHERE id = 1),
        'America/Argentina/Buenos_Aires'
    ) AS zona,
    hoy_instalacion() AS hoy
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
-- La próxima fecha: sin fecha, nula; sin ejecuciones, la primera; con ellas, la última más la frecuencia
CROSS JOIN LATERAL (
    SELECT CASE
        WHEN t.primera_fecha IS NULL THEN NULL
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
) ec ON TRUE
-- El estado por fecha: sin fecha, nulo
CROSS JOIN LATERAL (
    SELECT CASE
        WHEN p.proxima_fecha IS NULL THEN NULL
        WHEN p.proxima_fecha < z.hoy THEN 'VENCIDA'
        WHEN p.proxima_fecha <= z.hoy + pl.anticipacion_dias THEN 'PROXIMA'
        ELSE 'AL_DIA'
    END AS estado_fecha
) ef
-- La lectura actual: la vigente de mayor valor; a igual valor, la de mayor id
LEFT JOIN LATERAL (
    SELECT l.valor, l.registrada_en
    FROM lecturas_medidor l
    WHERE l.medidor_id = t.medidor_id
      AND l.anulada_en IS NULL
    ORDER BY l.valor DESC, l.id DESC
    LIMIT 1
) la ON TRUE
-- El último uso: el mayor valor registrado con el medidor de hoy, en una intervención
-- finalizada, no eliminada, con la tarea hecha
LEFT JOIN LATERAL (
    SELECT max(it.valor_medidor) AS ultimo_uso
    FROM intervencion_tareas it
    JOIN intervenciones i ON i.id = it.intervencion_id
    WHERE it.plan_tarea_id = t.id
      AND it.medidor_id = t.medidor_id
      AND it.hecha
      AND i.estado = 'FINALIZADA'
      AND i.eliminado_en IS NULL
) uu ON TRUE
-- La próxima por uso: sin medidor, nula; sin ejecuciones, la primera; con ellas, la última más el intervalo
CROSS JOIN LATERAL (
    SELECT CASE
        WHEN t.medidor_id IS NULL THEN NULL
        WHEN uu.ultimo_uso IS NULL THEN t.uso_primera
        ELSE uu.ultimo_uso + t.uso_cada
    END AS proximo_uso
) pu
-- El estado por uso: sin medidor, nulo
CROSS JOIN LATERAL (
    SELECT CASE
        WHEN t.medidor_id IS NULL THEN NULL
        WHEN la.valor IS NULL THEN 'SIN_LECTURA'
        WHEN pu.proximo_uso - la.valor < 0 THEN 'VENCIDA'
        WHEN pu.proximo_uso - la.valor <= t.uso_anticipacion THEN 'PROXIMA'
        ELSE 'AL_DIA'
    END AS estado_uso
) eu;

COMMIT;
