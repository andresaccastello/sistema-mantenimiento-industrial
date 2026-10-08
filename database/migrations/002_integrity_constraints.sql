-- database/migrations/002_integrity_constraints.sql
BEGIN;

-- 1. Impedir costos unitarios negativos en movimientos_stock
ALTER TABLE movimientos_stock 
    ADD CONSTRAINT ck_movimientos_costo_unitario 
    CHECK (costo_unitario IS NULL OR costo_unitario >= 0);

-- 2. Garantizar que el plan asociado a una intervención pertenezca a la misma máquina
-- Primero, creamos una restricción UNIQUE en planes_mantenimiento para (id, maquina_id)
-- Esto es necesario para poder referenciar este par en una Foreign Key.
ALTER TABLE planes_mantenimiento 
    ADD CONSTRAINT uq_planes_mantenimiento_maquina 
    UNIQUE (id, maquina_id);

-- Segundo, actualizamos la clave foránea en intervenciones para que incluya maquina_id.
-- Para poder hacer esto sin afectar los datos, primero eliminamos la FK anterior (opcional pero recomendado) y luego agregamos la nueva.
ALTER TABLE intervenciones
    DROP CONSTRAINT IF EXISTS fk_intervenciones_plan;

ALTER TABLE intervenciones
    ADD CONSTRAINT fk_intervenciones_plan_maquina 
    FOREIGN KEY (plan_mantenimiento_id, maquina_id) 
    REFERENCES planes_mantenimiento(id, maquina_id);

COMMIT;
