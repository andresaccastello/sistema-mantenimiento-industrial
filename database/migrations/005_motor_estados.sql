-- database/migrations/005_motor_estados.sql
-- Etapa 4A: Coherencia de máquina en intervenciones/períodos y restricción de espera de repuestos
BEGIN;

-- 1. Clave compuesta (id, maquina_id) en intervenciones para permitir FKs compuestas
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_intervenciones_id_maquina'
    ) THEN
        ALTER TABLE intervenciones
            ADD CONSTRAINT uq_intervenciones_id_maquina
            UNIQUE (id, maquina_id);
    END IF;
END $$;

-- 2. Coherencia de máquina en períodos de detención
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_periodos_intervencion_maquina'
    ) THEN
        ALTER TABLE intervencion_periodos_detencion
            ADD CONSTRAINT fk_periodos_intervencion_maquina
            FOREIGN KEY (intervencion_id, maquina_id)
            REFERENCES intervenciones (id, maquina_id)
            ON DELETE RESTRICT;
    END IF;
END $$;

-- 3. Coherencia de máquina en historial de estados de máquina
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_historial_maquina_intervencion_maquina'
    ) THEN
        ALTER TABLE historial_estados_maquina
            ADD CONSTRAINT fk_historial_maquina_intervencion_maquina
            FOREIGN KEY (intervencion_id, maquina_id)
            REFERENCES intervenciones (id, maquina_id)
            ON DELETE RESTRICT;
    END IF;
END $$;

-- 4. Observación obligatoria al pasar a espera de repuestos
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_historial_espera_observacion'
    ) THEN
        ALTER TABLE historial_estados_intervencion
            ADD CONSTRAINT ck_historial_espera_observacion
            CHECK (
                estado_nuevo != 'EN_ESPERA_REPUESTOS'
                OR (observacion IS NOT NULL AND TRIM(observacion) != '')
            );
    END IF;
END $$;

COMMIT;
