-- Migración 008: Notificaciones internas, canales y bandeja de salida
BEGIN;

-- 1. Tabla de notificaciones internas
CREATE TABLE IF NOT EXISTS notificaciones (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario_id BIGINT NOT NULL REFERENCES usuarios(id),
    tipo_evento VARCHAR(60) NOT NULL,
    prioridad VARCHAR(10) NOT NULL,
    titulo VARCHAR(200) NOT NULL,
    mensaje TEXT NOT NULL,
    intervencion_id BIGINT REFERENCES intervenciones(id) ON DELETE RESTRICT,
    maquina_id BIGINT REFERENCES maquinas(id) ON DELETE RESTRICT,
    generada_por_usuario_id BIGINT NOT NULL REFERENCES usuarios(id),
    creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    leida_en TIMESTAMPTZ,
    CONSTRAINT ck_notificaciones_prioridad
        CHECK (prioridad IN ('ALTA', 'NORMAL')),
    CONSTRAINT ck_notificaciones_no_autonotificar
        CHECK (generada_por_usuario_id <> usuario_id)
);

CREATE INDEX IF NOT EXISTS idx_notificaciones_usuario_creada 
    ON notificaciones (usuario_id, creada_en DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_notificaciones_usuario_no_leidas 
    ON notificaciones (usuario_id) WHERE leida_en IS NULL;

-- 2. Canales externos configurables
CREATE TABLE IF NOT EXISTS notificacion_canales (
    canal VARCHAR(20) PRIMARY KEY,
    activo BOOLEAN NOT NULL DEFAULT FALSE,
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_notificacion_canales_canal
        CHECK (canal IN ('EMAIL', 'WHATSAPP', 'PUSH'))
);

INSERT INTO notificacion_canales (canal, activo)
VALUES 
    ('EMAIL', FALSE),
    ('WHATSAPP', FALSE),
    ('PUSH', FALSE)
ON CONFLICT (canal) DO NOTHING;

-- 3. Bandeja de salida (notificacion_envios)
CREATE TABLE IF NOT EXISTS notificacion_envios (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    notificacion_id BIGINT NOT NULL REFERENCES notificaciones(id) ON DELETE RESTRICT,
    canal VARCHAR(20) NOT NULL REFERENCES notificacion_canales(canal),
    estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    intentos INTEGER NOT NULL DEFAULT 0,
    ultimo_error TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    enviado_en TIMESTAMPTZ,
    CONSTRAINT uq_notificacion_envios_notificacion_canal
        UNIQUE (notificacion_id, canal),
    CONSTRAINT ck_notificacion_envios_estado
        CHECK (estado IN ('PENDIENTE', 'ENVIADO', 'ERROR', 'DESCARTADO')),
    CONSTRAINT ck_notificacion_envios_intentos
        CHECK (intentos >= 0)
);

CREATE INDEX IF NOT EXISTS idx_notificacion_envios_canal_pendientes
    ON notificacion_envios (canal, creado_en) WHERE estado = 'PENDIENTE';

COMMIT;
