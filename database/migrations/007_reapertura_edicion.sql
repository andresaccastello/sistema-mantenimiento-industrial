-- database/migrations/007_reapertura_edicion.sql
BEGIN;

-- 1. Ampliar el CHECK de intervencion_auditoria agregando 'EDICION'
-- CORRECCION_TAREA es de la 018 (PV1): va también acá para que reaplicar esta
-- migración no la saque.
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

-- 2. Asignar permiso INTERVENCIONES_EDITAR con alcance PROPIAS al perfil OPERARIO
INSERT INTO perfil_permiso (perfil_id, permiso_id, alcance)
SELECT p.id, pe.id, 'PROPIAS'
FROM perfiles p
CROSS JOIN permisos pe
WHERE p.nombre = 'OPERARIO'
  AND pe.codigo = 'INTERVENCIONES_EDITAR'
ON CONFLICT (perfil_id, permiso_id) DO NOTHING;

COMMIT;
