-- database/migrations/025_avisos_criticos.sql
-- Etapa AV1: avisos de parada crítica y de stock bajo (D-034)
-- Los tipos PARADA_CRITICA y STOCK_BAJO, con sus reglas iniciales, van en la 015.
BEGIN;

-- 1. El enlace del aviso de stock
ALTER TABLE notificaciones
    ADD COLUMN IF NOT EXISTS repuesto_id BIGINT NULL REFERENCES repuestos(id) ON DELETE RESTRICT;

-- 2. Para avisar una sola vez hasta que se repone (sección 3)
ALTER TABLE repuestos
    ADD COLUMN IF NOT EXISTS stock_bajo_avisado_en TIMESTAMPTZ NULL;

-- 3. El switch: si la detención registrada después de reportar la falla también avisa (sección 2)
ALTER TABLE configuracion_sistema
    ADD COLUMN IF NOT EXISTS critico_por_detencion_posterior BOOLEAN NOT NULL DEFAULT TRUE;

-- 4. Los permisos nuevos (NOTIFICACIONES_CRITICAS_RECIBIR también está en la lista de la 014)
INSERT INTO permisos (codigo, nombre, descripcion, usa_alcance)
VALUES
    (
        'NOTIFICACIONES_CRITICAS_RECIBIR',
        'Recibir avisos de paradas críticas',
        'Permite recibir los avisos de las paradas de máquinas críticas, según el alcance',
        TRUE
    ),
    (
        'NOTIFICACIONES_STOCK_RECIBIR',
        'Recibir avisos de stock bajo',
        'Permite recibir los avisos de los repuestos que llegan a su stock mínimo',
        FALSE
    )
ON CONFLICT (codigo) DO UPDATE
SET nombre = EXCLUDED.nombre,
    descripcion = EXCLUDED.descripcion,
    usa_alcance = EXCLUDED.usa_alcance;

INSERT INTO perfil_permiso (perfil_id, permiso_id, alcance)
SELECT p.id, pe.id, 'TODAS'
FROM (VALUES
    ('ADMINISTRADOR', 'NOTIFICACIONES_CRITICAS_RECIBIR'),
    ('RESPONSABLE_MANTENIMIENTO', 'NOTIFICACIONES_CRITICAS_RECIBIR'),
    ('CONSULTA', 'NOTIFICACIONES_CRITICAS_RECIBIR'),
    ('ADMINISTRADOR', 'NOTIFICACIONES_STOCK_RECIBIR'),
    ('RESPONSABLE_MANTENIMIENTO', 'NOTIFICACIONES_STOCK_RECIBIR')
) AS x(perfil, permiso)
JOIN perfiles p ON p.nombre = x.perfil
JOIN permisos pe ON pe.codigo = x.permiso
ON CONFLICT (perfil_id, permiso_id) DO NOTHING;

COMMIT;
