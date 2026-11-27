-- database/migrations/027_intentos_ingreso.sql
-- Etapa PUB1: límite de intentos de ingreso (D-037)
BEGIN;

-- Cada intento de POST /api/auth/login, exitoso o no. El legajo va normalizado con
-- upper(trim()), exista o no: así " admin001 " y ADMIN001 son el mismo legajo.
CREATE TABLE IF NOT EXISTS intentos_ingreso (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    legajo VARCHAR(50) NOT NULL,
    exitoso BOOLEAN NOT NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_intentos_ingreso_legajo CHECK (legajo = upper(trim(legajo)))
);

CREATE INDEX IF NOT EXISTS idx_intentos_ingreso_legajo_creado
    ON intentos_ingreso (legajo, creado_en DESC);

COMMIT;
