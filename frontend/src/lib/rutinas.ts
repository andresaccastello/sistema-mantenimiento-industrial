/**
 * Tareas de rutina (Etapa RT1, D-033): lógica pura de "Tareas de hoy" (sección 4), de la ficha
 * de la máquina y del reporte (sección 5).
 * Las fechas sin hora (`YYYY-MM-DD`) se leen por año, mes y día, sin pasar por la zona horaria.
 */
import type {
  EstadoPeriodoRutina,
  FrecuenciaRutina,
  PeriodoReporteRutina,
  Persona,
  RegistroRutina,
  Rutina,
  RutinaHoy,
  RutinaReporte,
} from '../api/tipos';

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function partes(fecha: string): [number, number, number] {
  const [a, m, d] = fecha.split('-').map(Number);
  return [a, m, d];
}

/** "24/11", de una fecha `YYYY-MM-DD`. */
export function diaMes(fecha: string): string {
  const [, m, d] = partes(fecha);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

/** "martes", de una fecha `YYYY-MM-DD`. */
export function diaSemana(fecha: string): string {
  const [a, m, d] = partes(fecha);
  return DIAS_SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
}

/** El encabezado: "Tareas de hoy · martes 24/11". */
export function tituloTareasDeHoy(hoy: string): string {
  return `Tareas de hoy · ${diaSemana(hoy)} ${diaMes(hoy)}`;
}

/** El rótulo de la frecuencia: "Diaria" o "Semanal". */
export function rotuloFrecuencia(frecuencia: FrecuenciaRutina): string {
  return frecuencia === 'DIARIA' ? 'Diaria' : 'Semanal';
}

/** "L. Pérez"; sin apellido, el nombre. */
export function nombreCorto(persona: Pick<Persona, 'nombre' | 'apellido'>): string {
  const nombre = (persona.nombre || '').trim();
  const apellido = (persona.apellido || '').trim();
  if (nombre && apellido) return `${nombre.charAt(0).toUpperCase()}. ${apellido}`;
  return nombre || apellido;
}

function fechaLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * "Hecha por L. Pérez a las 10:32". Si se marcó otro día (una semanal hecha el lunes, vista el
 * martes), con el día: "Hecha por L. Pérez el lunes 23/11 a las 10:32". La hora, la local.
 */
export function textoHecha(registro: Pick<RegistroRutina, 'usuario' | 'hecha_en'>, hoy: string): string {
  const d = new Date(registro.hecha_en);
  const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const dia = fechaLocal(d);
  const cuando = dia === hoy ? `a las ${hora}` : `el ${diaSemana(dia)} ${diaMes(dia)} a las ${hora}`;
  return `Hecha por ${nombreCorto(registro.usuario)} ${cuando}`;
}

/** Se puede deshacer solo lo que marcó el usuario que está mirando. */
export function puedeDeshacer(registro: Pick<RegistroRutina, 'usuario'> | null, usuarioId: number | null | undefined): boolean {
  return registro !== null && usuarioId !== null && usuarioId !== undefined && registro.usuario.id === usuarioId;
}

export interface GrupoMaquina {
  maquina: RutinaHoy['maquina'];
  /** "COM-01 · Compresor · Pintura" */
  titulo: string;
  rutinas: RutinaHoy[];
}

function comparar(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? '').localeCompare(b ?? '', 'es', { sensitivity: 'base', numeric: true });
}

/**
 * Agrupa por máquina. Los grupos van por planta, sector y código de máquina; dentro de cada uno,
 * primero las que faltan y después las hechas, cada parte por descripción.
 */
export function agruparPorMaquina(rutinas: RutinaHoy[]): GrupoMaquina[] {
  const grupos = new Map<number, GrupoMaquina>();
  for (const r of rutinas) {
    let g = grupos.get(r.maquina.id);
    if (!g) {
      const partesTitulo = [r.maquina.codigo, r.maquina.nombre, r.maquina.sector.nombre].filter(Boolean);
      g = { maquina: r.maquina, titulo: partesTitulo.join(' · '), rutinas: [] };
      grupos.set(r.maquina.id, g);
    }
    g.rutinas.push(r);
  }
  const lista = [...grupos.values()];
  for (const g of lista) {
    g.rutinas.sort(
      (a, b) => Number(a.registro !== null) - Number(b.registro !== null) || comparar(a.descripcion, b.descripcion) || a.id - b.id
    );
  }
  return lista.sort(
    (a, b) =>
      comparar(a.maquina.planta?.nombre, b.maquina.planta?.nombre) ||
      comparar(a.maquina.sector.nombre, b.maquina.sector.nombre) ||
      comparar(a.maquina.codigo ?? a.maquina.nombre, b.maquina.codigo ?? b.maquina.nombre) ||
      a.maquina.id - b.maquina.id
  );
}

// =============================================================================
// La ficha de la máquina y el reporte (RT1, sección 5)
// =============================================================================

export interface EstadoVisual {
  rotulo: string;
  /** El relleno del punto o de la celda: una variable --sm-*, o transparente. */
  fondo: string;
  /** El borde: solo el pendiente lo lleva. */
  borde: string | null;
}

/** El color y el rótulo de cada estado: verde hecha, rojo no hecha, gris con borde pendiente. */
export function estadoVisual(estado: EstadoPeriodoRutina): EstadoVisual {
  if (estado === 'HECHA') return { rotulo: 'Hecha', fondo: 'var(--sm-exito)', borde: null };
  if (estado === 'NO_HECHA') return { rotulo: 'No hecha', fondo: 'var(--sm-peligro)', borde: null };
  return { rotulo: 'Pendiente', fondo: 'transparent', borde: 'var(--sm-muy-tenue)' };
}

/** "79 %", o "—" si no hay períodos cerrados. */
export function formatoPorcentaje(porcentaje: number | null): string {
  return porcentaje === null ? '—' : `${porcentaje} %`;
}

/** La fecha de un período: "24/11" en las diarias, "Semana del 23/11" en las semanales. */
export function textoPeriodo(periodo: string, frecuencia: FrecuenciaRutina): string {
  return frecuencia === 'SEMANAL' ? `Semana del ${diaMes(periodo)}` : diaMes(periodo);
}

/** "Diaria · incluye sábado", "Semanal". */
export function textoFrecuencia(rutina: Pick<Rutina, 'frecuencia' | 'incluye_sabado'>): string {
  const base = rotuloFrecuencia(rutina.frecuencia);
  return rutina.frecuencia === 'DIARIA' && rutina.incluye_sabado ? `${base} · incluye sábado` : base;
}

/** "Última vez: 21/11, L. Pérez"; sin ninguna, "Última vez: —". */
export function textoUltimaVez(ultima: { hecha_en: string; usuario: Pick<Persona, 'nombre' | 'apellido'> } | null): string {
  if (!ultima) return 'Última vez: —';
  return `Última vez: ${diaMes(fechaLocal(new Date(ultima.hecha_en)))}, ${nombreCorto(ultima.usuario)}`;
}

/** El tooltip de una celda del reporte: la fecha, el estado, quién y cuándo, y la nota. */
export function tooltipPeriodo(p: PeriodoReporteRutina, frecuencia: FrecuenciaRutina, hoy: string): string {
  const partesTexto = [`${textoPeriodo(p.periodo, frecuencia)}: ${estadoVisual(p.estado).rotulo}`];
  if (p.usuario && p.hecha_en) partesTexto.push(textoHecha({ usuario: p.usuario, hecha_en: p.hecha_en }, hoy));
  if (p.nota) partesTexto.push(`Nota: ${p.nota}`);
  return partesTexto.join(' · ');
}

export interface ColumnaGrilla {
  periodo: string;
  /** "ma 24/11" en las diarias; "23/11" (el lunes) en las semanales. */
  rotulo: string;
}

/**
 * Las columnas de una grilla del reporte: los períodos de las rutinas de esa frecuencia, sin
 * repetir y en orden. Un día que no le toca a ninguna diaria (un domingo) no tiene columna.
 */
export function columnasGrilla(rutinas: RutinaReporte[], frecuencia: FrecuenciaRutina): ColumnaGrilla[] {
  const periodos = new Set<string>();
  for (const r of rutinas) {
    if (r.frecuencia !== frecuencia) continue;
    for (const p of r.periodos) periodos.add(p.periodo);
  }
  return [...periodos].sort().map((periodo) => ({
    periodo,
    rotulo: frecuencia === 'DIARIA' ? `${diaSemana(periodo).slice(0, 2)} ${diaMes(periodo)}` : diaMes(periodo),
  }));
}

/** Las filas de una grilla: cada rutina de la frecuencia, con su período (o null) en cada columna. */
export function filasGrilla(
  rutinas: RutinaReporte[],
  frecuencia: FrecuenciaRutina,
  columnas: ColumnaGrilla[]
): Array<{ rutina: RutinaReporte; celdas: Array<PeriodoReporteRutina | null> }> {
  return rutinas
    .filter((r) => r.frecuencia === frecuencia)
    .map((rutina) => {
      const porPeriodo = new Map(rutina.periodos.map((p) => [p.periodo, p]));
      return { rutina, celdas: columnas.map((c) => porPeriodo.get(c.periodo) ?? null) };
    });
}

/** Los últimos `n` períodos de una rutina, para la lista del celular. */
export function ultimosPeriodos<T>(periodos: T[], n = 5): T[] {
  return periodos.slice(-n);
}

/** El nombre de la máquina en el reporte: "COM-01 · Compresor". */
export function nombreMaquina(maquina: Pick<Rutina['maquina'], 'codigo' | 'nombre'>): string {
  return [maquina.codigo, maquina.nombre].filter(Boolean).join(' · ');
}
