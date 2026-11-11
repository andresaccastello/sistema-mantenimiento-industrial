-- database/migrations/004_permisos_granulares.sql
-- Etapa 2: Catálogo de permisos granulares, alcances y excepciones por usuario
BEGIN;

-- 1. Modificar perfil_permiso para soportar alcance de visibilidad (C7)
ALTER TABLE perfil_permiso
    ADD COLUMN IF NOT EXISTS alcance VARCHAR(20) NOT NULL DEFAULT 'TODAS';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_perfil_permiso_alcance'
    ) THEN
        ALTER TABLE perfil_permiso
            ADD CONSTRAINT ck_perfil_permiso_alcance
            CHECK (alcance IN ('PROPIAS', 'SECTORES', 'TODAS'));
    END IF;
END $$;

-- 2. Nueva tabla: usuario_permiso (N5) - Excepciones individuales por usuario
CREATE TABLE IF NOT EXISTS usuario_permiso (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    permiso_id BIGINT NOT NULL REFERENCES permisos(id) ON DELETE CASCADE,
    efecto VARCHAR(10) NOT NULL,
    alcance VARCHAR(20) NOT NULL DEFAULT 'TODAS',
    motivo TEXT,
    otorgado_por_usuario_id BIGINT NOT NULL REFERENCES usuarios(id),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_usuario_permiso_efecto CHECK (efecto IN ('CONCEDER', 'DENEGAR')),
    CONSTRAINT ck_usuario_permiso_alcance CHECK (alcance IN ('PROPIAS', 'SECTORES', 'TODAS')),
    CONSTRAINT uq_usuario_permiso UNIQUE (usuario_id, permiso_id)
);

CREATE INDEX IF NOT EXISTS idx_usuario_permiso_usuario ON usuario_permiso (usuario_id);

-- 3. Nueva tabla: usuario_sector (N6) - Sectores autorizados para el usuario
CREATE TABLE IF NOT EXISTS usuario_sector (
    usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    sector_id BIGINT NOT NULL REFERENCES sectores(id) ON DELETE CASCADE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (usuario_id, sector_id)
);

CREATE INDEX IF NOT EXISTS idx_usuario_sector_usuario ON usuario_sector (usuario_id);

-- 4. Nueva tabla: auditoria_permisos (N7) - Registro de cambios de roles y permisos
CREATE TABLE IF NOT EXISTS auditoria_permisos (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    realizado_por_usuario_id BIGINT NOT NULL REFERENCES usuarios(id),
    sobre_usuario_id BIGINT REFERENCES usuarios(id),
    sobre_perfil_id BIGINT REFERENCES perfiles(id),
    accion VARCHAR(50) NOT NULL,
    detalle TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_permisos_usuario ON auditoria_permisos (sobre_usuario_id);

-- 5. Ampliar catálogo de permisos
INSERT INTO permisos (codigo, nombre, descripcion) VALUES
    ('INTERVENCIONES_VER', 'Ver intervenciones', 'Permite consultar intervenciones según el alcance (propias, sectores o todas)'),
    ('INTERVENCIONES_ASIGNARSE', 'Tomar intervención', 'Permite asignarse a uno mismo una intervención pendiente'),
    ('INTERVENCIONES_ASIGNAR', 'Asignar intervenciones', 'Permite asignar o reasignar intervenciones a otros responsables'),
    ('INTERVENCIONES_RECIBIR_ASIGNACION', 'Recibir asignaciones', 'Permite ser designado como responsable de una intervención'),
    ('INTERVENCIONES_CAMBIAR_ESTADO', 'Iniciar y cambiar estados', 'Permite pasar intervenciones a en proceso o en espera de repuestos'),
    ('INTERVENCIONES_EDITAR', 'Modificar datos técnicos', 'Permite editar descripción y datos de trabajo mientras no esté finalizada'),
    ('INTERVENCIONES_FINALIZAR', 'Finalizar intervenciones', 'Permite registrar la finalización del trabajo'),
    ('INTERVENCIONES_CANCELAR', 'Cancelar intervenciones', 'Permite cancelar intervenciones con motivo obligatorio'),
    ('INTERVENCIONES_ELIMINAR', 'Eliminación lógica', 'Permite ocultar o dar de baja una intervención conservando trazabilidad'),
    ('INTERVENCIONES_REABRIR', 'Reabrir intervenciones', 'Permite reabrir una intervención finalizada si la falla persiste'),
    ('INTERVENCIONES_CORREGIR', 'Corregir intervenciones finalizadas', 'Permite correcciones trazables de fechas o costos post-cierre'),
    ('INTERVENCIONES_CONFIRMAR_RECUPERACION', 'Confirmar recuperación de máquina', 'Permite cerrar períodos de detención y certificar funcionamiento'),
    ('COSTOS_VER', 'Consultar costos', 'Permite ver los montos y renglones de costos de intervenciones'),
    ('COSTOS_REGISTRAR', 'Cargar y anular costos', 'Permite registrar mano de obra, servicios externos, gastos y ajustes'),
    ('MAQUINAS_CAMBIAR_ESTADO', 'Cambiar estado de máquinas', 'Permite modificar manualmente el estado de las máquinas'),
    ('NOTIFICACIONES_FALLAS_RECIBIR', 'Recibir avisos de falla', 'Permite recibir notificaciones internas ante fallas nuevas'),
    ('PERMISOS_GESTIONAR', 'Administrar permisos y roles', 'Permite configurar perfiles, excepciones de usuarios y alcances')
ON CONFLICT (codigo) DO NOTHING;

-- 6. Configurar permisos iniciales por perfil
-- 6.1 ADMINISTRADOR: todos los permisos con alcance 'TODAS'
INSERT INTO perfil_permiso (perfil_id, permiso_id, alcance)
SELECT p.id, pe.id, 'TODAS'
FROM perfiles p
CROSS JOIN permisos pe
WHERE p.nombre = 'ADMINISTRADOR'
ON CONFLICT (perfil_id, permiso_id) DO UPDATE SET alcance = 'TODAS';

-- 6.2 RESPONSABLE_MANTENIMIENTO
INSERT INTO perfil_permiso (perfil_id, permiso_id, alcance)
SELECT p.id, pe.id, 'TODAS'
FROM perfiles p
JOIN permisos pe ON pe.codigo IN (
    'INTERVENCIONES_VER',
    'INTERVENCIONES_CREAR',
    'INTERVENCIONES_ASIGNARSE',
    'INTERVENCIONES_ASIGNAR',
    'INTERVENCIONES_RECIBIR_ASIGNACION',
    'INTERVENCIONES_CAMBIAR_ESTADO',
    'INTERVENCIONES_EDITAR',
    'INTERVENCIONES_FINALIZAR',
    'INTERVENCIONES_CANCELAR',
    'INTERVENCIONES_ELIMINAR',
    'INTERVENCIONES_REABRIR',
    'INTERVENCIONES_CONFIRMAR_RECUPERACION',
    'COSTOS_VER',
    'COSTOS_REGISTRAR',
    'MAQUINAS_CAMBIAR_ESTADO',
    'NOTIFICACIONES_FALLAS_RECIBIR',
    'REPUESTOS_GESTIONAR',
    'PLANES_GESTIONAR',
    'DOCUMENTOS_GESTIONAR',
    'REPORTES_CONSULTAR'
)
WHERE p.nombre = 'RESPONSABLE_MANTENIMIENTO'
ON CONFLICT (perfil_id, permiso_id) DO UPDATE SET alcance = 'TODAS';

-- 6.3 OPERARIO: crear fallas (TODAS) y ver intervenciones propias (PROPIAS)
INSERT INTO perfil_permiso (perfil_id, permiso_id, alcance)
SELECT p.id, pe.id, 'TODAS'
FROM perfiles p
JOIN permisos pe ON pe.codigo = 'INTERVENCIONES_CREAR'
WHERE p.nombre = 'OPERARIO'
ON CONFLICT (perfil_id, permiso_id) DO UPDATE SET alcance = 'TODAS';

INSERT INTO perfil_permiso (perfil_id, permiso_id, alcance)
SELECT p.id, pe.id, 'PROPIAS'
FROM perfiles p
JOIN permisos pe ON pe.codigo = 'INTERVENCIONES_VER'
WHERE p.nombre = 'OPERARIO'
ON CONFLICT (perfil_id, permiso_id) DO UPDATE SET alcance = 'PROPIAS';

-- 6.4 CONSULTA (Dirección / I+D)
INSERT INTO perfil_permiso (perfil_id, permiso_id, alcance)
SELECT p.id, pe.id, 'TODAS'
FROM perfiles p
JOIN permisos pe ON pe.codigo IN (
    'INTERVENCIONES_VER',
    'COSTOS_VER',
    'REPORTES_CONSULTAR'
)
WHERE p.nombre = 'CONSULTA'
ON CONFLICT (perfil_id, permiso_id) DO UPDATE SET alcance = 'TODAS';

COMMIT;
