-- database/migrations/026_maquina_documentos.sql
-- Etapa MQ1: documentos de la máquina como enlaces (D-035) y código SAE del proveedor
BEGIN;

-- 1. Los documentos de la máquina (sección 1.1): solo el enlace, el archivo vive afuera
CREATE TABLE IF NOT EXISTS maquina_documentos (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    maquina_id BIGINT NOT NULL REFERENCES maquinas(id),
    titulo VARCHAR(150) NOT NULL,
    tipo VARCHAR(12) NOT NULL,
    url VARCHAR(1000) NOT NULL,
    notas VARCHAR(500) NULL,
    creado_por_usuario_id BIGINT NOT NULL REFERENCES usuarios(id),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_maquina_documentos_titulo CHECK (btrim(titulo) <> ''),
    CONSTRAINT ck_maquina_documentos_tipo
        CHECK (tipo IN ('MANUAL', 'FOTO', 'VIDEO', 'INSTRUCTIVO', 'PLANO', 'OTRO')),
    CONSTRAINT ck_maquina_documentos_url CHECK (url ~* '^https?://')
);

CREATE INDEX IF NOT EXISTS idx_maquina_documentos_maquina
    ON maquina_documentos (maquina_id);

-- 2. El código del proveedor en SAE (sección 3)
ALTER TABLE proveedores
    ADD COLUMN IF NOT EXISTS codigo_externo VARCHAR(40) NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_proveedores_codigo_externo
    ON proveedores (upper(trim(codigo_externo)))
    WHERE codigo_externo IS NOT NULL;

COMMIT;
