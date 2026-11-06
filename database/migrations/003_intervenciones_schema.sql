-- database/migrations/003_intervenciones_schema.sql
-- Etapa 1: Modelo de datos y restricciones para el módulo de Intervenciones y Máquinas
BEGIN;

-- 1. Modificaciones a la tabla maquinas
-- Incorporar código único de máquina (Decisión D-18)
ALTER TABLE maquinas
    ADD COLUMN IF NOT EXISTS codigo VARCHAR(50);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_maquinas_codigo'
    ) THEN
        ALTER TABLE maquinas ADD CONSTRAINT uq_maquinas_codigo UNIQUE (codigo);
    END IF;
END $$;

-- 2. Modificaciones a la tabla intervenciones
-- 2.1 Tipo de ejecución (INTERNA / EXTERNA)
ALTER TABLE intervenciones
    ADD COLUMN IF NOT EXISTS ejecucion VARCHAR(20);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_intervenciones_ejecucion'
    ) THEN
        ALTER TABLE intervenciones
            ADD CONSTRAINT ck_intervenciones_ejecucion
            CHECK (ejecucion IS NULL OR ejecucion IN ('INTERNA', 'EXTERNA'));
    END IF;
END $$;

-- 2.2 Eliminación lógica con trazabilidad
ALTER TABLE intervenciones
    ADD COLUMN IF NOT EXISTS eliminado_en TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS eliminado_por_usuario_id BIGINT REFERENCES usuarios(id),
    ADD COLUMN IF NOT EXISTS motivo_eliminacion TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_intervenciones_eliminacion_logica'
    ) THEN
        ALTER TABLE intervenciones
            ADD CONSTRAINT ck_intervenciones_eliminacion_logica
            CHECK (
                eliminado_en IS NULL
                OR (eliminado_por_usuario_id IS NOT NULL AND motivo_eliminacion IS NOT NULL)
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_intervenciones_activas
    ON intervenciones (maquina_id, estado)
    WHERE eliminado_en IS NULL;

-- 2.3 Restricción de finalización: exige fecha_inicio y fecha_finalizacion
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_intervenciones_finalizada_fechas'
    ) THEN
        ALTER TABLE intervenciones
            ADD CONSTRAINT ck_intervenciones_finalizada_fechas
            CHECK (
                estado != 'FINALIZADA'
                OR (fecha_inicio IS NOT NULL AND fecha_finalizacion IS NOT NULL)
            );
    END IF;
END $$;

-- 3. Modificaciones a historial_estados_intervencion
-- Exigir motivo u observación al cancelar una intervención
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_historial_cancelada_observacion'
    ) THEN
        ALTER TABLE historial_estados_intervencion
            ADD CONSTRAINT ck_historial_cancelada_observacion
            CHECK (
                estado_nuevo != 'CANCELADA'
                OR (observacion IS NOT NULL AND TRIM(observacion) != '')
            );
    END IF;
END $$;

-- 4. Modificar FKs con ON DELETE CASCADE a RESTRICT para evitar destrucción accidental del historial
ALTER TABLE historial_estados_intervencion
    DROP CONSTRAINT IF EXISTS historial_estados_intervencion_intervencion_id_fkey,
    DROP CONSTRAINT IF EXISTS fk_historial_intervencion;

ALTER TABLE historial_estados_intervencion
    ADD CONSTRAINT fk_historial_intervencion
    FOREIGN KEY (intervencion_id) REFERENCES intervenciones(id) ON DELETE RESTRICT;

ALTER TABLE intervencion_repuestos
    DROP CONSTRAINT IF EXISTS intervencion_repuestos_intervencion_id_fkey,
    DROP CONSTRAINT IF EXISTS fk_intervencion_repuestos_intervencion;

ALTER TABLE intervencion_repuestos
    ADD CONSTRAINT fk_intervencion_repuestos_intervencion
    FOREIGN KEY (intervencion_id) REFERENCES intervenciones(id) ON DELETE RESTRICT;

ALTER TABLE documentos
    DROP CONSTRAINT IF EXISTS documentos_intervencion_id_fkey,
    DROP CONSTRAINT IF EXISTS fk_documentos_intervencion;

ALTER TABLE documentos
    ADD CONSTRAINT fk_documentos_intervencion
    FOREIGN KEY (intervencion_id) REFERENCES intervenciones(id) ON DELETE RESTRICT;

-- 5. Nueva tabla: historial_estados_maquina (Trazabilidad de estados y causa)
CREATE TABLE IF NOT EXISTS historial_estados_maquina (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    maquina_id BIGINT NOT NULL REFERENCES maquinas(id) ON DELETE RESTRICT,
    estado_anterior VARCHAR(40),
    estado_nuevo VARCHAR(40) NOT NULL,
    intervencion_id BIGINT REFERENCES intervenciones(id) ON DELETE RESTRICT,
    motivo TEXT,
    cambiado_por_usuario_id BIGINT NOT NULL REFERENCES usuarios(id),
    cambiado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_historial_maquina_estado_nuevo
        CHECK (estado_nuevo IN ('OPERATIVA', 'DETENIDA', 'EN_MANTENIMIENTO', 'FUERA_DE_SERVICIO')),
    CONSTRAINT ck_historial_maquina_estado_anterior
        CHECK (
            estado_anterior IS NULL
            OR estado_anterior IN ('OPERATIVA', 'DETENIDA', 'EN_MANTENIMIENTO', 'FUERA_DE_SERVICIO')
        )
);

CREATE INDEX IF NOT EXISTS idx_historial_maquina
    ON historial_estados_maquina (maquina_id, cambiado_en);

CREATE INDEX IF NOT EXISTS idx_historial_maquina_intervencion
    ON historial_estados_maquina (intervencion_id)
    WHERE intervencion_id IS NOT NULL;

-- 6. Nueva tabla: intervencion_periodos_detencion (Cálculo real de tiempos de inactividad)
CREATE TABLE IF NOT EXISTS intervencion_periodos_detencion (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    intervencion_id BIGINT NOT NULL REFERENCES intervenciones(id) ON DELETE RESTRICT,
    maquina_id BIGINT NOT NULL REFERENCES maquinas(id) ON DELETE RESTRICT,
    desde TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    hasta TIMESTAMPTZ,
    abierto_por_usuario_id BIGINT NOT NULL REFERENCES usuarios(id),
    confirmado_por_usuario_id BIGINT REFERENCES usuarios(id),
    observacion TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_periodos_detencion_fechas
        CHECK (hasta IS NULL OR hasta >= desde),
    CONSTRAINT ck_periodos_detencion_confirmacion
        CHECK (hasta IS NULL OR confirmado_por_usuario_id IS NOT NULL)
);

-- Solo puede haber 1 período de detención ABIERTO (hasta IS NULL) por intervención
CREATE UNIQUE INDEX IF NOT EXISTS uq_periodo_abierto_por_intervencion
    ON intervencion_periodos_detencion (intervencion_id)
    WHERE hasta IS NULL;

-- Índice para encontrar rápidamente qué máquinas están actualmente detenidas
CREATE INDEX IF NOT EXISTS idx_periodos_detencion_abiertos_maquina
    ON intervencion_periodos_detencion (maquina_id)
    WHERE hasta IS NULL;

CREATE INDEX IF NOT EXISTS idx_periodos_detencion_intervencion
    ON intervencion_periodos_detencion (intervencion_id);

-- 7. Nueva tabla: intervencion_auditoria (Trazabilidad de asignaciones, correcciones y reaperturas)
CREATE TABLE IF NOT EXISTS intervencion_auditoria (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    intervencion_id BIGINT NOT NULL REFERENCES intervenciones(id) ON DELETE RESTRICT,
    tipo_evento VARCHAR(50) NOT NULL,
    campo_modificado VARCHAR(80),
    valor_anterior TEXT,
    valor_nuevo TEXT,
    motivo TEXT,
    realizado_por_usuario_id BIGINT NOT NULL REFERENCES usuarios(id),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_intervencion_auditoria_evento
        CHECK (tipo_evento IN (
            'ASIGNACION',
            'DESASIGNACION',
            'CORRECCION_FECHA',
            'CORRECCION_COSTO',
            'ELIMINACION_LOGICA',
            'REAPERTURA',
            'OTRO'
        ))
);

CREATE INDEX IF NOT EXISTS idx_intervencion_auditoria_intervencion
    ON intervencion_auditoria (intervencion_id, creado_en);

-- 8. Nueva tabla: intervencion_costos (Renglones detallados de costo sin sobreescritura)
CREATE TABLE IF NOT EXISTS intervencion_costos (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    intervencion_id BIGINT NOT NULL REFERENCES intervenciones(id) ON DELETE RESTRICT,
    tipo VARCHAR(40) NOT NULL,
    descripcion TEXT NOT NULL,
    importe NUMERIC(14,2) NOT NULL,
    motivo TEXT,
    registrado_por_usuario_id BIGINT NOT NULL REFERENCES usuarios(id),
    registrado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    anulado_por_usuario_id BIGINT REFERENCES usuarios(id),
    anulado_en TIMESTAMPTZ,
    motivo_anulacion TEXT,
    CONSTRAINT ck_intervencion_costos_tipo
        CHECK (tipo IN ('MANO_OBRA', 'SERVICIO_EXTERNO', 'TRANSPORTE', 'OTRO', 'AJUSTE')),
    CONSTRAINT ck_intervencion_costos_importe
        CHECK (tipo = 'AJUSTE' OR importe >= 0),
    CONSTRAINT ck_intervencion_costos_anulacion
        CHECK (
            anulado_en IS NULL
            OR (anulado_por_usuario_id IS NOT NULL AND motivo_anulacion IS NOT NULL)
        )
);

CREATE INDEX IF NOT EXISTS idx_intervencion_costos_intervencion
    ON intervencion_costos (intervencion_id);

CREATE INDEX IF NOT EXISTS idx_intervencion_costos_tipo
    ON intervencion_costos (tipo);

COMMIT;
