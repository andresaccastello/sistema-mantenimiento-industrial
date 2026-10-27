-- database/migrations/009_usuarios.sql
-- Etapa U: Usuarios, perfiles y contraseñas
BEGIN;

-- 1. Columna debe_cambiar_password en usuarios
ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS debe_cambiar_password BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Columna password_actualizado_en en usuarios
ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS password_actualizado_en TIMESTAMPTZ;

-- 3. Perfiles nuevos
INSERT INTO perfiles (nombre, descripcion, activo)
VALUES
    ('I_D', 'I+D: coordina y gestiona intervenciones', TRUE),
    ('DIRECCION', 'Dirección: consulta, reportes y avisos de fallas', TRUE)
ON CONFLICT (nombre) DO NOTHING;

-- 4. Permisos por defecto (D-40)
-- 4.1 I_D: copiar todas las filas de perfil_permiso de RESPONSABLE_MANTENIMIENTO con su alcance
INSERT INTO perfil_permiso (perfil_id, permiso_id, alcance)
SELECT p_id.id, pp.permiso_id, pp.alcance
FROM perfiles p_id
CROSS JOIN perfiles p_resp
JOIN perfil_permiso pp ON pp.perfil_id = p_resp.id
WHERE p_id.nombre = 'I_D'
  AND p_resp.nombre = 'RESPONSABLE_MANTENIMIENTO'
ON CONFLICT (perfil_id, permiso_id) DO NOTHING;

-- 4.2 DIRECCION: copiar las de CONSULTA y agregar NOTIFICACIONES_FALLAS_RECIBIR con alcance TODAS
INSERT INTO perfil_permiso (perfil_id, permiso_id, alcance)
SELECT p_dir.id, pp.permiso_id, pp.alcance
FROM perfiles p_dir
CROSS JOIN perfiles p_cons
JOIN perfil_permiso pp ON pp.perfil_id = p_cons.id
WHERE p_dir.nombre = 'DIRECCION'
  AND p_cons.nombre = 'CONSULTA'
ON CONFLICT (perfil_id, permiso_id) DO NOTHING;

INSERT INTO perfil_permiso (perfil_id, permiso_id, alcance)
SELECT p.id, pe.id, 'TODAS'
FROM perfiles p
CROSS JOIN permisos pe
WHERE p.nombre = 'DIRECCION'
  AND pe.codigo = 'NOTIFICACIONES_FALLAS_RECIBIR'
ON CONFLICT (perfil_id, permiso_id) DO NOTHING;

-- 5. CHECK en auditoria_permisos.accion
DO $$
DECLARE
    invalid_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO invalid_count
    FROM auditoria_permisos
    WHERE accion NOT IN (
        'USUARIO_CREADO',
        'USUARIO_MODIFICADO',
        'PERFIL_CAMBIADO',
        'SECTORES_CAMBIADOS',
        'USUARIO_DESACTIVADO',
        'USUARIO_REACTIVADO',
        'PASSWORD_RESTABLECIDA',
        'PASSWORD_CAMBIADA'
    );

    IF invalid_count > 0 THEN
        RAISE EXCEPTION 'Hay % filas en auditoria_permisos con acciones no reconocidas para la migración 009', invalid_count;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_auditoria_permisos_accion'
    ) THEN
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
                'PASSWORD_CAMBIADA'
            ));
    END IF;
END $$;

COMMIT;
