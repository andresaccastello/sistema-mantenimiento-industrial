-- database/migrations/020_pedidos_compras.sql
-- Etapa PC1: pedidos que se usan al recibir y reporte de compras (D-029)
BEGIN;

-- 1. Lo que se guarda al recibir un pedido, aunque el repuesto no lleve stock
ALTER TABLE pedidos_repuesto
    ADD COLUMN IF NOT EXISTS costo_unitario NUMERIC(14,2) NULL,
    ADD COLUMN IF NOT EXISTS comprobante VARCHAR(60) NULL,
    ADD COLUMN IF NOT EXISTS consumo_id BIGINT NULL REFERENCES intervencion_repuestos(id);

-- 2. El precio de la compra no puede ser negativo
ALTER TABLE pedidos_repuesto
    DROP CONSTRAINT IF EXISTS ck_pedidos_repuesto_costo;
ALTER TABLE pedidos_repuesto
    ADD CONSTRAINT ck_pedidos_repuesto_costo CHECK (costo_unitario IS NULL OR costo_unitario >= 0);

COMMIT;
