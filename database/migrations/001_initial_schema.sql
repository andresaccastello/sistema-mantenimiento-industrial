BEGIN;

CREATE TABLE perfiles (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre VARCHAR(60) NOT NULL UNIQUE,
    descripcion TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE permisos (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo VARCHAR(80) NOT NULL UNIQUE,
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT
);

CREATE TABLE perfil_permiso (
    perfil_id BIGINT NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
    permiso_id BIGINT NOT NULL REFERENCES permisos(id) ON DELETE CASCADE,
    PRIMARY KEY (perfil_id, permiso_id)
);

CREATE TABLE usuarios (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    legajo VARCHAR(40) NOT NULL UNIQUE,
    nombre VARCHAR(100) NOT NULL,
    apellido VARCHAR(100),
    password_hash TEXT,
    perfil_id BIGINT NOT NULL REFERENCES perfiles(id),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    ultimo_acceso_en TIMESTAMPTZ,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sectores (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre VARCHAR(120) NOT NULL UNIQUE,
    descripcion TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE maquinas (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    sector_id BIGINT NOT NULL REFERENCES sectores(id),
    tipo VARCHAR(100),
    estado VARCHAR(40) NOT NULL DEFAULT 'OPERATIVA',
    ubicacion VARCHAR(180),
    observaciones TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_maquinas_estado
        CHECK (estado IN ('OPERATIVA', 'DETENIDA', 'EN_MANTENIMIENTO', 'FUERA_DE_SERVICIO'))
);

CREATE TABLE tipos_intervencion (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo VARCHAR(50) NOT NULL UNIQUE,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    descripcion TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE intervenciones (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    maquina_id BIGINT NOT NULL REFERENCES maquinas(id),
    sector_id BIGINT NOT NULL REFERENCES sectores(id),
    tipo_intervencion_id BIGINT NOT NULL REFERENCES tipos_intervencion(id),
    creado_por_usuario_id BIGINT NOT NULL REFERENCES usuarios(id),
    responsable_usuario_id BIGINT REFERENCES usuarios(id),
    descripcion TEXT NOT NULL,
    estado VARCHAR(40) NOT NULL DEFAULT 'PENDIENTE',
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fecha_inicio TIMESTAMPTZ,
    fecha_finalizacion TIMESTAMPTZ,
    tiempo_inactividad_minutos INTEGER,
    costo_mano_obra NUMERIC(14,2) NOT NULL DEFAULT 0,
    costo_repuestos NUMERIC(14,2) NOT NULL DEFAULT 0,
    costo_total_estimado NUMERIC(14,2) NOT NULL DEFAULT 0,
    observaciones TEXT,
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_intervenciones_estado
        CHECK (estado IN ('PENDIENTE', 'EN_PROCESO', 'EN_ESPERA_REPUESTOS', 'FINALIZADA', 'CANCELADA')),
    CONSTRAINT ck_intervenciones_fechas
        CHECK (fecha_finalizacion IS NULL OR fecha_inicio IS NULL OR fecha_finalizacion >= fecha_inicio),
    CONSTRAINT ck_intervenciones_inactividad
        CHECK (tiempo_inactividad_minutos IS NULL OR tiempo_inactividad_minutos >= 0),
    CONSTRAINT ck_intervenciones_costos
        CHECK (
            costo_mano_obra >= 0
            AND costo_repuestos >= 0
            AND costo_total_estimado >= 0
        )
);

CREATE TABLE historial_estados_intervencion (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    intervencion_id BIGINT NOT NULL REFERENCES intervenciones(id) ON DELETE CASCADE,
    estado_anterior VARCHAR(40),
    estado_nuevo VARCHAR(40) NOT NULL,
    cambiado_por_usuario_id BIGINT NOT NULL REFERENCES usuarios(id),
    observacion TEXT,
    cambiado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_historial_estado_nuevo
        CHECK (estado_nuevo IN ('PENDIENTE', 'EN_PROCESO', 'EN_ESPERA_REPUESTOS', 'FINALIZADA', 'CANCELADA')),
    CONSTRAINT ck_historial_estado_anterior
        CHECK (
            estado_anterior IS NULL
            OR estado_anterior IN ('PENDIENTE', 'EN_PROCESO', 'EN_ESPERA_REPUESTOS', 'FINALIZADA', 'CANCELADA')
        )
);

CREATE TABLE repuestos (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    proveedor VARCHAR(150),
    costo_unitario NUMERIC(14,2) NOT NULL DEFAULT 0,
    cantidad_disponible NUMERIC(14,3) NOT NULL DEFAULT 0,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_repuestos_costo CHECK (costo_unitario >= 0),
    CONSTRAINT ck_repuestos_cantidad CHECK (cantidad_disponible >= 0)
);

CREATE TABLE intervencion_repuestos (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    intervencion_id BIGINT NOT NULL REFERENCES intervenciones(id) ON DELETE CASCADE,
    repuesto_id BIGINT NOT NULL REFERENCES repuestos(id),
    cantidad NUMERIC(14,3) NOT NULL,
    costo_unitario_aplicado NUMERIC(14,2) NOT NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_intervencion_repuestos_cantidad CHECK (cantidad > 0),
    CONSTRAINT ck_intervencion_repuestos_costo CHECK (costo_unitario_aplicado >= 0)
);

CREATE TABLE movimientos_stock (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    repuesto_id BIGINT NOT NULL REFERENCES repuestos(id),
    intervencion_id BIGINT REFERENCES intervenciones(id),
    tipo VARCHAR(20) NOT NULL,
    cantidad NUMERIC(14,3) NOT NULL,
    observacion TEXT,
    realizado_por_usuario_id BIGINT NOT NULL REFERENCES usuarios(id),
    realizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_movimientos_stock_tipo CHECK (tipo IN ('INGRESO', 'EGRESO', 'AJUSTE')),
    CONSTRAINT ck_movimientos_stock_cantidad CHECK (cantidad > 0)
);

CREATE TABLE planes_mantenimiento (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    maquina_id BIGINT NOT NULL REFERENCES maquinas(id),
    responsable_usuario_id BIGINT REFERENCES usuarios(id),
    nombre VARCHAR(150) NOT NULL,
    descripcion TEXT,
    criterio VARCHAR(30) NOT NULL,
    frecuencia_valor NUMERIC(14,2) NOT NULL,
    frecuencia_unidad VARCHAR(30) NOT NULL,
    proxima_fecha DATE,
    proximo_valor_objetivo NUMERIC(14,2),
    observaciones TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_planes_criterio
        CHECK (criterio IN ('TIEMPO', 'HORAS_USO', 'KILOMETROS', 'OTRO')),
    CONSTRAINT ck_planes_frecuencia CHECK (frecuencia_valor > 0)
);

CREATE TABLE documentos (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    maquina_id BIGINT REFERENCES maquinas(id) ON DELETE CASCADE,
    intervencion_id BIGINT REFERENCES intervenciones(id) ON DELETE CASCADE,
    nombre_original VARCHAR(255) NOT NULL,
    tipo_documento VARCHAR(60),
    mime_type VARCHAR(150),
    storage_key TEXT NOT NULL,
    tamanio_bytes BIGINT,
    subido_por_usuario_id BIGINT NOT NULL REFERENCES usuarios(id),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_documentos_asociacion
        CHECK (maquina_id IS NOT NULL OR intervencion_id IS NOT NULL),
    CONSTRAINT ck_documentos_tamanio
        CHECK (tamanio_bytes IS NULL OR tamanio_bytes >= 0)
);

CREATE INDEX idx_usuarios_perfil ON usuarios(perfil_id);
CREATE INDEX idx_maquinas_sector ON maquinas(sector_id);
CREATE INDEX idx_intervenciones_maquina ON intervenciones(maquina_id);
CREATE INDEX idx_intervenciones_sector ON intervenciones(sector_id);
CREATE INDEX idx_intervenciones_responsable ON intervenciones(responsable_usuario_id);
CREATE INDEX idx_intervenciones_estado ON intervenciones(estado);
CREATE INDEX idx_intervenciones_fecha_creacion ON intervenciones(fecha_creacion);
CREATE INDEX idx_historial_intervencion ON historial_estados_intervencion(intervencion_id, cambiado_en);
CREATE INDEX idx_intervencion_repuestos_intervencion ON intervencion_repuestos(intervencion_id);
CREATE INDEX idx_intervencion_repuestos_repuesto ON intervencion_repuestos(repuesto_id);
CREATE INDEX idx_movimientos_stock_repuesto ON movimientos_stock(repuesto_id, realizado_en);
CREATE INDEX idx_planes_maquina ON planes_mantenimiento(maquina_id);
CREATE INDEX idx_planes_proxima_fecha ON planes_mantenimiento(proxima_fecha) WHERE activo = TRUE;
CREATE INDEX idx_documentos_maquina ON documentos(maquina_id);
CREATE INDEX idx_documentos_intervencion ON documentos(intervencion_id);

INSERT INTO perfiles (nombre, descripcion) VALUES
    ('ADMINISTRADOR', 'Acceso general y administración del sistema'),
    ('RESPONSABLE_MANTENIMIENTO', 'Gestión y seguimiento de intervenciones de mantenimiento'),
    ('OPERARIO', 'Registro de fallas o necesidades de mantenimiento'),
    ('CONSULTA', 'Consulta de reportes e historial para Dirección o I+D');

INSERT INTO permisos (codigo, nombre) VALUES
    ('USUARIOS_GESTIONAR', 'Gestionar usuarios'),
    ('MAQUINAS_GESTIONAR', 'Gestionar máquinas y sectores'),
    ('INTERVENCIONES_CREAR', 'Crear intervenciones'),
    ('INTERVENCIONES_GESTIONAR', 'Gestionar intervenciones'),
    ('REPUESTOS_GESTIONAR', 'Gestionar repuestos y stock'),
    ('PLANES_GESTIONAR', 'Gestionar planes de mantenimiento'),
    ('DOCUMENTOS_GESTIONAR', 'Gestionar documentación respaldatoria'),
    ('REPORTES_CONSULTAR', 'Consultar reportes e historial');

INSERT INTO perfil_permiso (perfil_id, permiso_id)
SELECT p.id, pe.id
FROM perfiles p
CROSS JOIN permisos pe
WHERE p.nombre = 'ADMINISTRADOR';

INSERT INTO perfil_permiso (perfil_id, permiso_id)
SELECT p.id, pe.id
FROM perfiles p
JOIN permisos pe ON pe.codigo IN (
    'INTERVENCIONES_CREAR',
    'INTERVENCIONES_GESTIONAR',
    'REPUESTOS_GESTIONAR',
    'PLANES_GESTIONAR',
    'DOCUMENTOS_GESTIONAR',
    'REPORTES_CONSULTAR'
)
WHERE p.nombre = 'RESPONSABLE_MANTENIMIENTO';

INSERT INTO perfil_permiso (perfil_id, permiso_id)
SELECT p.id, pe.id
FROM perfiles p
JOIN permisos pe ON pe.codigo = 'INTERVENCIONES_CREAR'
WHERE p.nombre = 'OPERARIO';

INSERT INTO perfil_permiso (perfil_id, permiso_id)
SELECT p.id, pe.id
FROM perfiles p
JOIN permisos pe ON pe.codigo = 'REPORTES_CONSULTAR'
WHERE p.nombre = 'CONSULTA';

INSERT INTO tipos_intervencion (codigo, nombre, descripcion) VALUES
    ('CORRECTIVO', 'Mantenimiento correctivo', 'Intervención originada por una falla o desperfecto'),
    ('PREVENTIVO', 'Mantenimiento preventivo', 'Intervención planificada para prevenir fallas');

COMMIT;
