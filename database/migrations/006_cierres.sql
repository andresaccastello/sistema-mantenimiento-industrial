-- database/migrations/006_cierres.sql
-- Etapa 4B: Cierres, trabajo realizado y observación de confirmación
BEGIN;

-- 1. intervenciones.trabajo_realizado TEXT (nulo)
ALTER TABLE intervenciones
    ADD COLUMN IF NOT EXISTS trabajo_realizado TEXT;

-- 2. intervencion_periodos_detencion.observacion_confirmacion TEXT (nulo)
ALTER TABLE intervencion_periodos_detencion
    ADD COLUMN IF NOT EXISTS observacion_confirmacion TEXT;

-- 3. Restricción ck_intervenciones_finalizada_datos:
-- Toda intervención FINALIZADA debe contar con trabajo_realizado no vacío y ejecucion no nula.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_intervenciones_finalizada_datos'
    ) THEN
        ALTER TABLE intervenciones
            ADD CONSTRAINT ck_intervenciones_finalizada_datos
            CHECK (
                estado != 'FINALIZADA'
                OR (trabajo_realizado IS NOT NULL AND TRIM(trabajo_realizado) != '' AND ejecucion IS NOT NULL)
            );
    END IF;
END $$;

COMMIT;
