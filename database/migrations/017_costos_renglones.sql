-- database/migrations/017_costos_renglones.sql
-- Etapa C1: Costos de la intervención (renglones con mano de obra por persona)
BEGIN;

-- 1. Columnas nuevas en intervencion_costos
ALTER TABLE intervencion_costos
    ADD COLUMN IF NOT EXISTS usuario_id BIGINT NULL REFERENCES usuarios(id);

ALTER TABLE intervencion_costos
    ADD COLUMN IF NOT EXISTS proveedor_id BIGINT NULL REFERENCES proveedores(id);

ALTER TABLE intervencion_costos
    ADD COLUMN IF NOT EXISTS horas NUMERIC(8,2) NULL;

ALTER TABLE intervencion_costos
    ADD COLUMN IF NOT EXISTS valor_hora NUMERIC(14,2) NULL;

-- 2. Renglones que ya existen (C1.1): si alguno no cumple las reglas nuevas,
-- la migración falla y no corrige nada. Cada condición es la del CHECK de la
-- sección 3; un NULL no cuenta como incumplimiento, igual que en el CHECK.
DO $$
DECLARE
    v_ids TEXT;
BEGIN
    SELECT string_agg(t.id::TEXT, ', ' ORDER BY t.id)
    INTO v_ids
    FROM (
        SELECT c.id
        FROM intervencion_costos c
        WHERE NOT (c.horas IS NULL OR (c.tipo = 'MANO_OBRA' AND c.horas > 0))
           OR NOT (
                c.tipo <> 'MANO_OBRA'
                OR (c.horas IS NOT NULL AND num_nonnulls(c.usuario_id, c.proveedor_id) = 1)
              )
           OR NOT (c.usuario_id IS NULL OR c.tipo = 'MANO_OBRA')
           OR NOT (
                c.valor_hora IS NULL
                OR (c.horas IS NOT NULL AND c.valor_hora >= 0 AND c.importe = round(c.horas * c.valor_hora, 2))
              )
           OR NOT (c.tipo <> 'AJUSTE' OR (c.importe <> 0 AND c.motivo IS NOT NULL))
        ORDER BY c.id
        LIMIT 20
    ) t;

    IF v_ids IS NOT NULL THEN
        RAISE EXCEPTION 'Hay renglones de costo que no cumplen las reglas nuevas: %. Revisarlos antes de migrar.', v_ids;
    END IF;
END
$$;

-- 3. Restricciones nuevas, validadas sobre todas las filas (sin NOT VALID).
-- Los nombres van después de ck_intervencion_costos_importe en orden alfabético,
-- que es el orden en que PostgreSQL controla los CHECK.

-- 3.1 horas solo en MANO_OBRA, y mayores que 0
ALTER TABLE intervencion_costos
    DROP CONSTRAINT IF EXISTS ck_intervencion_costos_mo_horas;

ALTER TABLE intervencion_costos
    ADD CONSTRAINT ck_intervencion_costos_mo_horas
    CHECK (horas IS NULL OR (tipo = 'MANO_OBRA' AND horas > 0));

-- 3.2 un MANO_OBRA tiene horas y exactamente uno de usuario_id o proveedor_id
ALTER TABLE intervencion_costos
    DROP CONSTRAINT IF EXISTS ck_intervencion_costos_mo_persona;

ALTER TABLE intervencion_costos
    ADD CONSTRAINT ck_intervencion_costos_mo_persona
    CHECK (
        tipo <> 'MANO_OBRA'
        OR (horas IS NOT NULL AND num_nonnulls(usuario_id, proveedor_id) = 1)
    );

-- 3.3 usuario_id solo en MANO_OBRA
ALTER TABLE intervencion_costos
    DROP CONSTRAINT IF EXISTS ck_intervencion_costos_usuario_mo;

ALTER TABLE intervencion_costos
    ADD CONSTRAINT ck_intervencion_costos_usuario_mo
    CHECK (usuario_id IS NULL OR tipo = 'MANO_OBRA');

-- 3.4 valor_hora solo con horas, desde 0, y entonces importe = round(horas * valor_hora, 2)
ALTER TABLE intervencion_costos
    DROP CONSTRAINT IF EXISTS ck_intervencion_costos_valor_hora;

ALTER TABLE intervencion_costos
    ADD CONSTRAINT ck_intervencion_costos_valor_hora
    CHECK (
        valor_hora IS NULL
        OR (horas IS NOT NULL AND valor_hora >= 0 AND importe = round(horas * valor_hora, 2))
    );

-- 3.5 AJUSTE: importe distinto de 0 y con motivo
ALTER TABLE intervencion_costos
    DROP CONSTRAINT IF EXISTS ck_intervencion_costos_ajuste;

ALTER TABLE intervencion_costos
    ADD CONSTRAINT ck_intervencion_costos_ajuste
    CHECK (tipo <> 'AJUSTE' OR (importe <> 0 AND motivo IS NOT NULL));

-- 4. Índices parciales
CREATE INDEX IF NOT EXISTS idx_intervencion_costos_usuario
    ON intervencion_costos (usuario_id)
    WHERE usuario_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_intervencion_costos_proveedor
    ON intervencion_costos (proveedor_id)
    WHERE proveedor_id IS NOT NULL;

-- 5. Costos cargados antes (RN-44): si hay intervenciones sin renglones con
-- importes que no salen de los repuestos, la migración falla y no corrige nada.
DO $$
DECLARE
    v_ids TEXT;
BEGIN
    SELECT string_agg(t.id::TEXT, ', ' ORDER BY t.id)
    INTO v_ids
    FROM (
        SELECT i.id
        FROM intervenciones i
        WHERE NOT EXISTS (
                SELECT 1 FROM intervencion_costos c WHERE c.intervencion_id = i.id
              )
          AND (
                i.costo_mano_obra <> 0
                OR i.costo_total_estimado <> i.costo_repuestos + i.costo_mano_obra
              )
        ORDER BY i.id
        LIMIT 20
    ) t;

    IF v_ids IS NOT NULL THEN
        RAISE EXCEPTION 'Hay intervenciones con costos cargados a mano: %. Revisarlas antes de migrar.', v_ids;
    END IF;
END
$$;

COMMIT;
