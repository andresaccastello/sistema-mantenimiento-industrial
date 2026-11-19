-- database/migrations/021_ronda_lecturas.sql
-- Etapa LE1: ronda de lecturas y lecturas atrasadas (D-030)
BEGIN;

-- 1. Cada cuántos días se lee el medidor (NULL: sin control de atraso) y cuándo se avisó
-- el atraso. Con el DEFAULT, los medidores que ya existen quedan con 7.
ALTER TABLE medidores
    ADD COLUMN IF NOT EXISTS lectura_cada_dias SMALLINT NULL DEFAULT 7,
    ADD COLUMN IF NOT EXISTS atraso_avisado_en TIMESTAMPTZ NULL;

ALTER TABLE medidores
    DROP CONSTRAINT IF EXISTS ck_medidores_lectura_cada_dias;

ALTER TABLE medidores
    ADD CONSTRAINT ck_medidores_lectura_cada_dias
    CHECK (lectura_cada_dias BETWEEN 1 AND 365);

COMMIT;
