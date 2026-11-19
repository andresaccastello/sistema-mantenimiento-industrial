-- database/migrations/014_excepciones_permisos.sql
-- Etapa API-05: Excepciones de permisos por usuario
BEGIN;

-- 1. Columna usa_alcance en permisos (propiedad del sistema, TRUE en los 5 permisos cuyo alcance se usa)
ALTER TABLE permisos
    ADD COLUMN IF NOT EXISTS usa_alcance BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE permisos
SET usa_alcance = (codigo IN (
    'INTERVENCIONES_VER',
    'INTERVENCIONES_CREAR',
    'INTERVENCIONES_EDITAR',
    'REPORTES_CONSULTAR',
    'NOTIFICACIONES_FALLAS_RECIBIR'
));

-- 2. Restricción ck_auditoria_permisos_accion ampliada para aceptar acciones de excepciones
ALTER TABLE auditoria_permisos
    DROP CONSTRAINT IF EXISTS ck_auditoria_permisos_accion;

ALTER TABLE auditoria_permisos
    ADD CONSTRAINT ck_auditoria_permisos_accion
    CHECK (accion IN (
        'USUARIO_CREADO',
        'USUARIO_MODIFICADO',
        'PERFIL_CAMBIADO',
        'SECTORES_CAMBIADOS',
        'USUARIO_DESACTIVADO',
        'USUARIO_REACTIVADO',
        'PASSWORD_RESTABLECIDA',
        'PASSWORD_CAMBIADA',
        'EXCEPCION_CREADA',
        'EXCEPCION_MODIFICADA',
        'EXCEPCION_ELIMINADA'
    ));

COMMIT;
