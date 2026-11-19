-- database/migrations/023_uso_estimado.sql
-- Etapa HE1: horómetro estimado (D-032)
BEGIN;

-- 1. Lo que declara el usuario: cuánto se usa el medidor, por día, semana o mes. Y cuándo se
-- avisó la lectura por estimación (sección 4). Es lo único que se guarda.
ALTER TABLE medidores
    ADD COLUMN IF NOT EXISTS uso_estimado_valor NUMERIC(14,2) NULL,
    ADD COLUMN IF NOT EXISTS uso_estimado_periodo VARCHAR(6) NULL,
    ADD COLUMN IF NOT EXISTS estimacion_avisada_en TIMESTAMPTZ NULL;

ALTER TABLE medidores
    DROP CONSTRAINT IF EXISTS ck_medidores_uso_estimado_valor,
    DROP CONSTRAINT IF EXISTS ck_medidores_uso_estimado_periodo,
    DROP CONSTRAINT IF EXISTS ck_medidores_uso_estimado_completo;

ALTER TABLE medidores
    ADD CONSTRAINT ck_medidores_uso_estimado_valor
    CHECK (uso_estimado_valor > 0);

ALTER TABLE medidores
    ADD CONSTRAINT ck_medidores_uso_estimado_periodo
    CHECK (uso_estimado_periodo IN ('DIA', 'SEMANA', 'MES'));

-- Las dos nulas o las dos con valor
ALTER TABLE medidores
    ADD CONSTRAINT ck_medidores_uso_estimado_completo
    CHECK ((uso_estimado_valor IS NULL) = (uso_estimado_periodo IS NULL));

-- Las vistas se vuelven a crear: la de las tareas depende de la de los medidores
DROP VIEW IF EXISTS v_plan_tareas_estimacion;
DROP VIEW IF EXISTS v_medidores_ritmo;

-- 1.1 El ritmo de uso de cada medidor, por día. Es el único lugar donde se calcula.
CREATE VIEW v_medidores_ritmo AS
SELECT
    md.id AS medidor_id,
    d.ritmo_declarado,
    l.ritmo_lecturas,
    CASE WHEN l.ritmo_lecturas IS NOT NULL THEN l.usadas END AS lecturas_usadas,
    CASE WHEN l.ritmo_lecturas IS NOT NULL THEN l.desde END AS lecturas_desde,
    CASE WHEN l.ritmo_lecturas IS NOT NULL THEN l.hasta END AS lecturas_hasta,
    COALESCE(l.ritmo_lecturas, d.ritmo_declarado) AS ritmo,
    CASE
        WHEN l.ritmo_lecturas IS NOT NULL THEN 'LECTURAS'
        WHEN d.ritmo_declarado IS NOT NULL THEN 'DECLARADO'
    END AS fuente,
    CASE
        WHEN l.ritmo_lecturas IS NOT NULL AND d.ritmo_declarado IS NOT NULL
        THEN round((l.ritmo_lecturas - d.ritmo_declarado) / d.ritmo_declarado * 100)::int
    END AS desvio_pct,
    -- El valor de hoy según el ritmo: la última lectura vigente (la de mayor valor, como en
    -- v_plan_tareas_estado) más el ritmo por los días que pasaron desde su fecha local
    CASE
        WHEN ul.valor IS NOT NULL AND COALESCE(l.ritmo_lecturas, d.ritmo_declarado) IS NOT NULL
        THEN round(
            ul.valor + COALESCE(l.ritmo_lecturas, d.ritmo_declarado)
                * (z.hoy - (ul.registrada_en AT TIME ZONE z.zona)::date),
            2
        )
    END AS valor_estimado_hoy
FROM medidores md
CROSS JOIN (
    SELECT COALESCE(
        (SELECT zona_horaria FROM configuracion_sistema WHERE id = 1),
        'America/Argentina/Buenos_Aires'
    ) AS zona,
    hoy_instalacion() AS hoy
) z
-- El declarado, por día: el mes cuenta como 30 días
CROSS JOIN LATERAL (
    SELECT CASE md.uso_estimado_periodo
        WHEN 'DIA' THEN md.uso_estimado_valor
        WHEN 'SEMANA' THEN md.uso_estimado_valor / 7
        WHEN 'MES' THEN md.uso_estimado_valor / 30
    END AS ritmo_declarado
) d
-- La última lectura vigente
LEFT JOIN LATERAL (
    SELECT lm.valor, lm.registrada_en
    FROM lecturas_medidor lm
    WHERE lm.medidor_id = md.id AND lm.anulada_en IS NULL
    ORDER BY lm.valor DESC, lm.id DESC
    LIMIT 1
) ul ON TRUE
-- Las lecturas que se usan: las vigentes de los últimos 60 días; si son menos de 3, las 3 últimas
CROSS JOIN LATERAL (
    SELECT
        count(*)::int AS usadas,
        min(x.registrada_en) AS desde,
        max(x.registrada_en) AS hasta,
        (array_agg(x.valor ORDER BY x.registrada_en ASC, x.id ASC))[1] AS valor_desde,
        (array_agg(x.valor ORDER BY x.registrada_en DESC, x.id DESC))[1] AS valor_hasta
    FROM (
        SELECT lm.id, lm.valor, lm.registrada_en,
               row_number() OVER (ORDER BY lm.registrada_en DESC, lm.id DESC) AS n,
               count(*) FILTER (WHERE lm.registrada_en >= now() - interval '60 days') OVER () AS en_ventana
        FROM lecturas_medidor lm
        WHERE lm.medidor_id = md.id AND lm.anulada_en IS NULL
    ) x
    WHERE x.registrada_en >= now() - interval '60 days'
       OR (x.en_ventana < 3 AND x.n <= 3)
) w
-- El ritmo según las lecturas: al menos 3, con 7 días o más entre la primera y la última
CROSS JOIN LATERAL (
    SELECT w.usadas, w.desde, w.hasta,
           CASE
               WHEN w.usadas >= 3 AND EXTRACT(EPOCH FROM (w.hasta - w.desde)) / 86400 >= 7
               THEN (w.valor_hasta - w.valor_desde) / (EXTRACT(EPOCH FROM (w.hasta - w.desde)) / 86400)
           END AS ritmo_lecturas
) l;

-- 1.2 La fecha estimada de cada tarea con medidor. Sobre v_plan_tareas_estado, que no se toca.
-- Solo informa: el estado de la tarea sigue saliendo de la lectura real (D-032, punto 4).
CREATE VIEW v_plan_tareas_estimacion AS
SELECT
    v.id AS tarea_id,
    v.plan_id,
    v.medidor_id,
    v.activo,
    v.estado,
    v.estado_uso,
    v.primera_fecha,
    v.proxima_fecha,
    v.proximo_uso,
    v.uso_anticipacion,
    v.lectura_actual,
    v.hoy,
    r.ritmo,
    r.fuente,
    b.fecha_base,
    f.fecha_estimada,
    f.fecha_aviso_estimada,
    r.valor_estimado_hoy,
    COALESCE(f.fecha_estimada < v.hoy, FALSE) AS estimada_pasada
FROM v_plan_tareas_estado v
JOIN v_medidores_ritmo r ON r.medidor_id = v.medidor_id
-- La fecha base: la fecha local de la última lectura
CROSS JOIN LATERAL (
    SELECT (v.lectura_actual_en AT TIME ZONE COALESCE(
        (SELECT zona_horaria FROM configuracion_sistema WHERE id = 1),
        'America/Argentina/Buenos_Aires'
    ))::date AS fecha_base
) b
-- Los días hasta cada umbral. Sin estimación: sin ritmo o con ritmo 0, sin lectura, ya vencida
-- por uso, o con la tarea en curso o inactiva. Más de 100 años no es una fecha útil.
CROSS JOIN LATERAL (
    SELECT
        CASE WHEN r.ritmo > 0 AND v.lectura_actual IS NOT NULL
                  AND v.estado_uso IN ('AL_DIA', 'PROXIMA') AND v.estado NOT IN ('EN_CURSO', 'INACTIVA')
             THEN ceil((v.proximo_uso - v.lectura_actual) / r.ritmo)
        END AS dias,
        CASE WHEN r.ritmo > 0 AND v.lectura_actual IS NOT NULL
                  AND v.estado_uso = 'AL_DIA' AND v.estado NOT IN ('EN_CURSO', 'INACTIVA')
             THEN ceil((v.proximo_uso - v.uso_anticipacion - v.lectura_actual) / r.ritmo)
        END AS dias_aviso
) c
CROSS JOIN LATERAL (
    SELECT
        CASE WHEN c.dias <= 36500 THEN b.fecha_base + c.dias::int END AS fecha_estimada,
        CASE WHEN c.dias <= 36500 AND c.dias_aviso <= 36500 THEN b.fecha_base + c.dias_aviso::int END AS fecha_aviso_estimada
) f
WHERE v.medidor_id IS NOT NULL;

COMMIT;
