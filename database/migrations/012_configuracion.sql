-- database/migrations/012_configuracion.sql
BEGIN;

CREATE TABLE IF NOT EXISTS configuracion_sistema (
    id SMALLINT PRIMARY KEY DEFAULT 1,
    nombre_sistema TEXT NOT NULL DEFAULT 'Sistema de Mantenimiento Industrial',
    nombre_empresa TEXT NULL,
    logo BYTEA NULL,
    logo_tipo TEXT NULL,
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_configuracion_id CHECK (id = 1),
    CONSTRAINT ck_configuracion_logo_tamano CHECK (octet_length(logo) <= 307200),
    CONSTRAINT ck_configuracion_logo_tipo CHECK (logo_tipo IN ('image/png', 'image/jpeg', 'image/webp')),
    CONSTRAINT ck_configuracion_logo_coherente CHECK ((logo IS NULL) = (logo_tipo IS NULL))
);

INSERT INTO configuracion_sistema (id, nombre_sistema)
VALUES (1, 'Sistema de Mantenimiento Industrial')
ON CONFLICT (id) DO NOTHING;

COMMIT;
