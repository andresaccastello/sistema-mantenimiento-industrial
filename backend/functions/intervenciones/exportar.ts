import { pool } from '../db.ts';
import { getUserScope } from '../middleware.ts';
import { ErrorNegocio, responderError } from './errores.ts';
import { armarFiltrosListado } from './filtrosListado.ts';
import { obtenerParticipantes, Participantes } from './participantes.ts';
import { UsuarioVisibilidad } from './visibilidad.ts';

/**
 * MQ1, 2.2: GET /api/intervenciones/exportar. El historial filtrado, como CSV para Excel en castellano:
 * UTF-8 con BOM, ";" como separador, "," como separador decimal y fechas dd/mm/aaaa hh:mm.
 * Los mismos filtros y la misma visibilidad que el listado. El costo total, solo con COSTOS_VER.
 */

export const MAXIMO_EXPORTACION = 5000;
let maximoFilas = MAXIMO_EXPORTACION;

/** Para las pruebas (MX-05): forzar el máximo sin crear 5.000 filas. Sin argumento, vuelve a 5.000. */
export function fijarMaximoExportacion(maximo: number = MAXIMO_EXPORTACION): void {
  maximoFilas = maximo;
}

const NOMBRES_ESTADO: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  EN_PROCESO: 'En proceso',
  EN_ESPERA_REPUESTOS: 'En espera de repuestos',
  FINALIZADA: 'Finalizada',
  CANCELADA: 'Cancelada',
};

const NOMBRES_TIPO: Record<string, string> = {
  CORRECTIVO: 'Correctivo',
  PREVENTIVO: 'Preventivo',
};

/** Un texto que empieza con =, +, - o @ lleva un ' adelante: así Excel no lo toma como fórmula. */
export function textoSeguro(valor: string | null | undefined): string {
  const t = valor ?? '';
  return /^[=+\-@]/.test(t) ? `'${t}` : t;
}

/** Entre comillas si lleva ;, comillas o saltos de línea. */
function celda(valor: string): string {
  return /[";\r\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;
}

function decimal(valor: number): string {
  return valor.toFixed(2).replace('.', ',');
}

function nombrePersona(nombre: string | null, apellido: string | null): string {
  return [nombre, apellido].filter((x) => x && String(x).trim() !== '').join(' ');
}

function textoParticipantes(p: Participantes): string {
  const internos = p.internos.map((x) => nombrePersona(x.nombre, x.apellido)).join(', ');
  const externos = p.externos.map((x) => x.nombre).join(', ');
  return [internos, externos].filter((x) => x !== '').join(' · ');
}

export async function exportarIntervenciones(c: any) {
  try {
    const usuario: UsuarioVisibilidad = {
      id: (c.get as any)('userId') as number,
      permisos: ((c.get as any)('userPermissionsMap') as Record<string, any>) || {},
      sectores: ((c.get as any)('userSectores') as number[]) || [],
    };
    const userScope = getUserScope(c, 'INTERVENCIONES_VER') || 'TODAS';
    const veCostos = 'COSTOS_VER' in usuario.permisos;

    const filtros = await armarFiltrosListado(c, usuario, userScope);
    const { whereClause, params } = filtros.vacio
      ? { whereClause: 'WHERE FALSE', params: [] as any[] }
      : filtros;

    const FROM = `
      FROM intervenciones i
      JOIN maquinas m ON i.maquina_id = m.id
      JOIN sectores s ON m.sector_id = s.id
      JOIN tipos_intervencion ti ON i.tipo_intervencion_id = ti.id`;

    const total = Number((await pool.query(`SELECT COUNT(*) AS total ${FROM} ${whereClause}`, params)).rows[0].total);
    if (total > maximoFilas) {
      throw new ErrorNegocio(
        422,
        'DEMASIADOS_RESULTADOS',
        `Son ${total.toLocaleString('es-AR')} intervenciones; acotá el filtro (máximo ${maximoFilas.toLocaleString('es-AR')})`,
        { total, maximo: maximoFilas }
      );
    }

    const zona = `(SELECT zona_horaria FROM configuracion_sistema WHERE id = 1)`;
    const fecha = (col: string) => `to_char(${col} AT TIME ZONE ${zona}, 'DD/MM/YYYY HH24:MI')`;
    const res = await pool.query(
      `SELECT i.id, ti.codigo AS tipo, i.estado, i.descripcion,
              m.codigo AS maquina_codigo, m.nombre AS maquina_nombre,
              s.nombre AS sector_nombre, p.nombre AS planta_nombre,
              ${fecha('i.fecha_creacion')} AS creada,
              ${fecha('i.fecha_inicio')} AS inicio,
              ${fecha('i.fecha_finalizacion')} AS fin,
              ur.nombre AS responsable_nombre, ur.apellido AS responsable_apellido,
              COALESCE(vit.inactividad_minutos, 0) AS inactividad_minutos,
              i.costo_total_estimado
       ${FROM}
       LEFT JOIN plantas p ON p.id = s.planta_id
       LEFT JOIN usuarios ur ON ur.id = i.responsable_usuario_id
       LEFT JOIN v_intervencion_tiempos vit ON vit.intervencion_id = i.id
       ${whereClause}
       ORDER BY i.fecha_creacion DESC, i.id DESC`,
      params
    );

    const participantes = await obtenerParticipantes(pool, res.rows.map((r) => Number(r.id)));
    const hoy = (await pool.query(`SELECT to_char(hoy_instalacion(), 'YYYY-MM-DD') AS d`)).rows[0].d as string;

    const encabezado = [
      'Número', 'Tipo', 'Estado', 'Código de máquina', 'Máquina', 'Sector', 'Planta',
      'Creada', 'Inicio', 'Fin', 'Responsable', 'Participantes', 'Descripción', 'Detención (h)',
      ...(veCostos ? ['Costo total'] : []),
    ];
    const lineas = [encabezado.map(celda).join(';')];
    for (const r of res.rows) {
      const textos = [
        String(r.id),
        NOMBRES_TIPO[r.tipo] ?? r.tipo,
        NOMBRES_ESTADO[r.estado] ?? r.estado,
        textoSeguro(r.maquina_codigo),
        textoSeguro(r.maquina_nombre),
        textoSeguro(r.sector_nombre),
        textoSeguro(r.planta_nombre),
        r.creada ?? '',
        r.inicio ?? '',
        r.fin ?? '',
        textoSeguro(nombrePersona(r.responsable_nombre, r.responsable_apellido)),
        textoSeguro(textoParticipantes(participantes.get(Number(r.id))!)),
        textoSeguro(r.descripcion),
        decimal(Number(r.inactividad_minutos) / 60),
        ...(veCostos ? [r.costo_total_estimado === null ? '' : decimal(Number(r.costo_total_estimado))] : []),
      ];
      lineas.push(textos.map(celda).join(';'));
    }

    const cuerpo = '﻿' + lineas.join('\r\n') + '\r\n';
    return c.body(cuerpo, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="intervenciones-${hoy}.csv"`,
    });
  } catch (error) {
    return responderError(c, error);
  }
}
