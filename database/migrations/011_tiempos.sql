-- database/migrations/011_tiempos.sql
-- Etapa 8: Tiempos de gestión e inactividad real de las máquinas
-- Requiere PostgreSQL 14 o superior (soporte nativo de tstzmultirange y range_agg).

-- ----------------------------------------------------------------------------
-- 1. Vista v_intervencion_tiempos
-- ----------------------------------------------------------------------------
-- Proporciona los indicadores temporales derivados para cada intervención:
-- - espera_minutos: tiempo transcurrido desde la creación hasta el inicio efectivo.
-- - espera_en_curso: TRUE si la intervención aún no comenzó y no fue cancelada.
-- - duracion_bruta_minutos: tiempo de calendario entre inicio y finalización (o hasta NOW() si está abierta).
-- - duracion_neta_minutos: tiempo real en EN_PROCESO acumulado en el historial (D-44).
-- - tiempo_total_minutos: tiempo total de ciclo (espera + trabajo) para finalizadas.
-- - trabajo_en_curso: TRUE si está en EN_PROCESO o EN_ESPERA_REPUESTOS.
-- - inactividad_minutos: suma acumulada de todos sus períodos de detención de máquina.
-- - inactividad_en_curso: TRUE si posee un período de detención actualmente abierto.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_intervencion_tiempos AS
WITH hist_seq AS (
  SELECT
    h.intervencion_id,
    h.estado_nuevo,
    h.cambiado_en,
    LEAD(h.cambiado_en) OVER (
      PARTITION BY h.intervencion_id
      ORDER BY h.cambiado_en ASC, h.id ASC
    ) AS next_cambiado_en,
    LEAD(h.cambiado_en, 2) OVER (
      PARTITION BY h.intervencion_id
      ORDER BY h.cambiado_en ASC, h.id ASC
    ) AS next_next_cambiado_en,
    LEAD(h.estado_nuevo) OVER (
      PARTITION BY h.intervencion_id
      ORDER BY h.cambiado_en ASC, h.id ASC
    ) AS next_estado_nuevo,
    ROW_NUMBER() OVER (
      PARTITION BY h.intervencion_id, (h.estado_nuevo = 'EN_PROCESO')
      ORDER BY h.cambiado_en ASC, h.id ASC
    ) AS rn_en_proceso
  FROM historial_estados_intervencion h
),
tramos_netos AS (
  SELECT
    s.intervencion_id,
    ROUND(SUM(
      GREATEST(
        0,
        EXTRACT(EPOCH FROM (
          CASE
            WHEN s.next_cambiado_en IS NULL THEN NOW()
            WHEN s.next_estado_nuevo = 'FINALIZADA' AND s.next_next_cambiado_en IS NULL AND i.fecha_finalizacion IS NOT NULL THEN i.fecha_finalizacion
            ELSE s.next_cambiado_en
          END
          -
          CASE
            WHEN s.rn_en_proceso = 1 THEN COALESCE(i.fecha_inicio, s.cambiado_en)
            ELSE s.cambiado_en
          END
        ))
      )
    ) / 60)::INTEGER AS neta_minutos
  FROM hist_seq s
  JOIN intervenciones i ON i.id = s.intervencion_id
  WHERE s.estado_nuevo = 'EN_PROCESO'
  GROUP BY s.intervencion_id
),
detenciones_agg AS (
  SELECT
    p.intervencion_id,
    COALESCE(ROUND(SUM(EXTRACT(EPOCH FROM (COALESCE(p.hasta, NOW()) - p.desde)) / 60)), 0)::INTEGER AS inactividad_minutos,
    COALESCE(BOOL_OR(p.hasta IS NULL), FALSE) AS inactividad_en_curso
  FROM intervencion_periodos_detencion p
  GROUP BY p.intervencion_id
),
tiempos_base AS (
  SELECT
    i.id AS intervencion_id,
    CASE
      WHEN i.fecha_inicio IS NOT NULL THEN
        ROUND(EXTRACT(EPOCH FROM (i.fecha_inicio - i.fecha_creacion)) / 60)::INTEGER
      WHEN i.estado != 'CANCELADA' THEN
        ROUND(EXTRACT(EPOCH FROM (NOW() - i.fecha_creacion)) / 60)::INTEGER
      ELSE NULL
    END AS espera_minutos,
    (i.fecha_inicio IS NULL AND i.estado != 'CANCELADA') AS espera_en_curso,
    CASE
      WHEN i.fecha_inicio IS NOT NULL AND i.fecha_finalizacion IS NOT NULL AND i.estado = 'FINALIZADA' THEN
        ROUND(EXTRACT(EPOCH FROM (i.fecha_finalizacion - i.fecha_inicio)) / 60)::INTEGER
      WHEN i.fecha_inicio IS NOT NULL AND i.estado IN ('EN_PROCESO', 'EN_ESPERA_REPUESTOS') THEN
        ROUND(EXTRACT(EPOCH FROM (NOW() - i.fecha_inicio)) / 60)::INTEGER
      ELSE NULL
    END AS duracion_bruta_minutos,
    CASE
      WHEN i.fecha_finalizacion IS NOT NULL AND i.estado = 'FINALIZADA' THEN
        ROUND(EXTRACT(EPOCH FROM (i.fecha_finalizacion - i.fecha_creacion)) / 60)::INTEGER
      ELSE NULL
    END AS tiempo_total_minutos,
    (i.estado IN ('EN_PROCESO', 'EN_ESPERA_REPUESTOS')) AS trabajo_en_curso,
    COALESCE(d.inactividad_minutos, 0) AS inactividad_minutos,
    COALESCE(d.inactividad_en_curso, FALSE) AS inactividad_en_curso,
    tn.neta_minutos AS neta_raw
  FROM intervenciones i
  LEFT JOIN detenciones_agg d ON d.intervencion_id = i.id
  LEFT JOIN tramos_netos tn ON tn.intervencion_id = i.id
)
SELECT
  tb.intervencion_id,
  tb.espera_minutos,
  tb.espera_en_curso,
  tb.duracion_bruta_minutos,
  CASE
    WHEN i.fecha_inicio IS NULL AND i.estado != 'CANCELADA' THEN NULL
    WHEN i.fecha_inicio IS NULL AND i.estado = 'CANCELADA' THEN 0
    WHEN tb.neta_raw IS NULL THEN 0
    WHEN tb.duracion_bruta_minutos IS NOT NULL THEN
      LEAST(tb.neta_raw, tb.duracion_bruta_minutos)
    ELSE tb.neta_raw
  END AS duracion_neta_minutos,
  tb.tiempo_total_minutos,
  tb.trabajo_en_curso,
  tb.inactividad_minutos,
  tb.inactividad_en_curso
FROM tiempos_base tb
JOIN intervenciones i ON i.id = tb.intervencion_id;


-- ----------------------------------------------------------------------------
-- 2. Función fn_inactividad_maquina(p_maquina_id, p_desde, p_hasta)
-- ----------------------------------------------------------------------------
-- Calcula la inactividad real de una máquina en un intervalo de tiempo.
-- Paso 1: Obtener los períodos de detención de intervenciones válidas (no eliminadas).
-- Paso 2: Unir los períodos usando multirangos (range_agg) evitando doble cómputo por solapamiento.
-- Paso 3: Identificar los períodos en que la máquina estuvo FUERA_DE_SERVICIO (D-07) y restarlos.
-- Paso 4: Recortar la unión al intervalo [p_desde, p_hasta].
-- Paso 5: Calcular la suma de minutos reales para el total, correctivos y preventivos,
--         así como el tiempo fuera de servicio descontado.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_inactividad_maquina(
    p_maquina_id BIGINT,
    p_desde TIMESTAMPTZ,
    p_hasta TIMESTAMPTZ
)
RETURNS TABLE (
    total_minutos INTEGER,
    correctivo_minutos INTEGER,
    preventivo_minutos INTEGER,
    fuera_de_servicio_minutos INTEGER
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_rango_consulta tstzmultirange;
    v_mr_fds tstzmultirange;
    v_mr_detenciones_all tstzmultirange;
    v_mr_correctivo tstzmultirange;
    v_mr_preventivo tstzmultirange;
    v_mr_neto tstzmultirange;
    v_mr_corr_neto tstzmultirange;
    v_mr_prev_neto tstzmultirange;
    v_mr_fds_descontado tstzmultirange;
BEGIN
    -- 1. Intervalo solicitado normalizado como multirango
    v_rango_consulta := tstzmultirange(tstzrange(p_desde, p_hasta));

    -- 2. Fuera de servicio (D-07):
    -- Intervalos en que la máquina estuvo en estado FUERA_DE_SERVICIO.
    -- Cada fila con estado_nuevo = 'FUERA_DE_SERVICIO' abre un intervalo que cierra
    -- la fila siguiente en el historial de la máquina, o NOW() si continúa en dicho estado.
    WITH fds_secuencia AS (
        SELECT
            hem.estado_nuevo,
            hem.cambiado_en AS fds_desde,
            COALESCE(
                LEAD(hem.cambiado_en) OVER (ORDER BY hem.cambiado_en ASC, hem.id ASC),
                NOW()
            ) AS fds_hasta
        FROM historial_estados_maquina hem
        WHERE hem.maquina_id = p_maquina_id
    )
    SELECT COALESCE(
        range_agg(tstzrange(fds_desde, fds_hasta)),
        '{}'::tstzmultirange
    )
    INTO v_mr_fds
    FROM fds_secuencia
    WHERE estado_nuevo = 'FUERA_DE_SERVICIO';

    -- 3. Detenciones por tipo (D-45, D-46):
    -- Períodos de detención de la máquina asociados a intervenciones no eliminadas lógicamente.
    -- Los períodos abiertos (hasta IS NULL) se computan hasta NOW().
    -- La función range_agg fusiona automáticamente solapamientos en un tstzmultirange.
    SELECT
        COALESCE(range_agg(tstzrange(p.desde, COALESCE(p.hasta, NOW()))), '{}'::tstzmultirange),
        COALESCE(range_agg(tstzrange(p.desde, COALESCE(p.hasta, NOW()))) FILTER (WHERE ti.codigo = 'CORRECTIVO'), '{}'::tstzmultirange),
        COALESCE(range_agg(tstzrange(p.desde, COALESCE(p.hasta, NOW()))) FILTER (WHERE ti.codigo = 'PREVENTIVO'), '{}'::tstzmultirange)
    INTO v_mr_detenciones_all, v_mr_correctivo, v_mr_preventivo
    FROM intervencion_periodos_detencion p
    JOIN intervenciones i ON i.id = p.intervencion_id
    JOIN tipos_intervencion ti ON ti.id = i.tipo_intervencion_id
    WHERE p.maquina_id = p_maquina_id
      AND i.eliminado_en IS NULL;

    -- 4. Operaciones de álgebra de rangos:
    -- Restamos los intervalos de FUERA_DE_SERVICIO de las detenciones y recortamos al intervalo pedido (*).
    -- El tiempo descontado por FUERA_DE_SERVICIO corresponde a la intersección de detenciones con FDS recortada.
    v_mr_neto := (v_mr_detenciones_all - v_mr_fds) * v_rango_consulta;
    v_mr_corr_neto := (v_mr_correctivo - v_mr_fds) * v_rango_consulta;
    v_mr_prev_neto := (v_mr_preventivo - v_mr_fds) * v_rango_consulta;
    v_mr_fds_descontado := (v_mr_detenciones_all * v_mr_fds) * v_rango_consulta;

    -- 5. Cálculo y redondeo a minutos enteros (suma de duraciones en segundos dividida por 60):
    SELECT COALESCE(ROUND(SUM(EXTRACT(EPOCH FROM (upper(r) - lower(r)))) / 60)::INTEGER, 0)
    INTO total_minutos
    FROM unnest(v_mr_neto) AS r;

    SELECT COALESCE(ROUND(SUM(EXTRACT(EPOCH FROM (upper(r) - lower(r)))) / 60)::INTEGER, 0)
    INTO correctivo_minutos
    FROM unnest(v_mr_corr_neto) AS r;

    SELECT COALESCE(ROUND(SUM(EXTRACT(EPOCH FROM (upper(r) - lower(r)))) / 60)::INTEGER, 0)
    INTO preventivo_minutos
    FROM unnest(v_mr_prev_neto) AS r;

    SELECT COALESCE(ROUND(SUM(EXTRACT(EPOCH FROM (upper(r) - lower(r)))) / 60)::INTEGER, 0)
    INTO fuera_de_servicio_minutos
    FROM unnest(v_mr_fds_descontado) AS r;

    RETURN NEXT;
END;
$$;
