-- database/migrations/015_avisos_email.sql
-- Etapa N1a: Avisos por email: backend
BEGIN;

-- 1. Datos de contacto en usuarios
ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS email VARCHAR(254) NULL;

ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS telefono_whatsapp VARCHAR(16) NULL;

ALTER TABLE usuarios
    DROP CONSTRAINT IF EXISTS ck_usuarios_email;

ALTER TABLE usuarios
    ADD CONSTRAINT ck_usuarios_email
    CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

ALTER TABLE usuarios
    DROP CONSTRAINT IF EXISTS ck_usuarios_telefono_whatsapp;

ALTER TABLE usuarios
    ADD CONSTRAINT ck_usuarios_telefono_whatsapp
    CHECK (telefono_whatsapp IS NULL OR telefono_whatsapp ~ '^\+[1-9][0-9]{7,14}$');

-- 2. Cambios en tablas existentes de notificaciones
ALTER TABLE notificacion_canales
    ADD COLUMN IF NOT EXISTS actualizado_por_usuario_id BIGINT NULL REFERENCES usuarios(id);

ALTER TABLE notificacion_envios
    ADD COLUMN IF NOT EXISTS proximo_intento_en TIMESTAMPTZ NULL;

ALTER TABLE notificacion_envios
    ADD COLUMN IF NOT EXISTS destino VARCHAR(254) NULL;

CREATE INDEX IF NOT EXISTS idx_notificacion_envios_pendientes
    ON notificacion_envios (canal, proximo_intento_en)
    WHERE estado = 'PENDIENTE';

-- 3. Nueva tabla notificacion_reglas
CREATE TABLE IF NOT EXISTS notificacion_reglas (
    tipo_evento VARCHAR(60) NOT NULL,
    canal VARCHAR(20) NOT NULL REFERENCES notificacion_canales(canal),
    modo VARCHAR(10) NOT NULL DEFAULT 'NUNCA',
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_por_usuario_id BIGINT NULL REFERENCES usuarios(id),
    CONSTRAINT pk_notificacion_reglas PRIMARY KEY (tipo_evento, canal),
    CONSTRAINT ck_notificacion_reglas_canal CHECK (canal IN ('EMAIL', 'WHATSAPP')),
    CONSTRAINT ck_notificacion_reglas_modo CHECK (modo IN ('NUNCA', 'SOLO_ALTA', 'SIEMPRE'))
);

-- Los tipos de aviso, con DROP/ADD para que una base existente tome los nuevos
-- (PV5: PREVENTIVO_VENCIMIENTO)
ALTER TABLE notificacion_reglas
    DROP CONSTRAINT IF EXISTS ck_notificacion_reglas_tipo_evento;

ALTER TABLE notificacion_reglas
    ADD CONSTRAINT ck_notificacion_reglas_tipo_evento CHECK (tipo_evento IN (
        'FALLA_REGISTRADA',
        'INTERVENCION_ASIGNADA',
        'INTERVENCION_REASIGNADA',
        'INTERVENCION_DESASIGNADA',
        'INTERVENCION_FINALIZADA',
        'INTERVENCION_CANCELADA',
        'INTERVENCION_REABIERTA',
        'DETENCION_PENDIENTE_CONFIRMACION',
        'PREVENTIVO_VENCIMIENTO'
    ));

-- Valores iniciales para notificacion_reglas (18 filas, no sobrescribe cambios posteriores)
INSERT INTO notificacion_reglas (tipo_evento, canal, modo) VALUES
    ('FALLA_REGISTRADA', 'EMAIL', 'SOLO_ALTA'),
    ('FALLA_REGISTRADA', 'WHATSAPP', 'NUNCA'),
    ('INTERVENCION_ASIGNADA', 'EMAIL', 'SIEMPRE'),
    ('INTERVENCION_ASIGNADA', 'WHATSAPP', 'NUNCA'),
    ('INTERVENCION_REASIGNADA', 'EMAIL', 'SIEMPRE'),
    ('INTERVENCION_REASIGNADA', 'WHATSAPP', 'NUNCA'),
    ('INTERVENCION_DESASIGNADA', 'EMAIL', 'NUNCA'),
    ('INTERVENCION_DESASIGNADA', 'WHATSAPP', 'NUNCA'),
    ('INTERVENCION_FINALIZADA', 'EMAIL', 'NUNCA'),
    ('INTERVENCION_FINALIZADA', 'WHATSAPP', 'NUNCA'),
    ('INTERVENCION_CANCELADA', 'EMAIL', 'NUNCA'),
    ('INTERVENCION_CANCELADA', 'WHATSAPP', 'NUNCA'),
    ('INTERVENCION_REABIERTA', 'EMAIL', 'NUNCA'),
    ('INTERVENCION_REABIERTA', 'WHATSAPP', 'NUNCA'),
    ('DETENCION_PENDIENTE_CONFIRMACION', 'EMAIL', 'SIEMPRE'),
    ('DETENCION_PENDIENTE_CONFIRMACION', 'WHATSAPP', 'NUNCA'),
    ('PREVENTIVO_VENCIMIENTO', 'EMAIL', 'SOLO_ALTA'),
    ('PREVENTIVO_VENCIMIENTO', 'WHATSAPP', 'NUNCA')
ON CONFLICT (tipo_evento, canal) DO NOTHING;

-- 4. Permiso CONFIGURACION_GESTIONAR
INSERT INTO permisos (codigo, nombre, descripcion, usa_alcance)
VALUES (
    'CONFIGURACION_GESTIONAR',
    'Gestionar la configuración',
    'Permite cambiar la configuración general del sistema, como los avisos por email',
    FALSE
)
ON CONFLICT (codigo) DO UPDATE
SET nombre = EXCLUDED.nombre,
    descripcion = EXCLUDED.descripcion,
    usa_alcance = EXCLUDED.usa_alcance;

-- Asignar CONFIGURACION_GESTIONAR al perfil ADMINISTRADOR exclusivamente
INSERT INTO perfil_permiso (perfil_id, permiso_id, alcance)
SELECT p.id, pe.id, 'TODAS'
FROM perfiles p
JOIN permisos pe ON pe.codigo = 'CONFIGURACION_GESTIONAR'
WHERE p.nombre = 'ADMINISTRADOR'
ON CONFLICT (perfil_id, permiso_id) DO NOTHING;


COMMIT;
