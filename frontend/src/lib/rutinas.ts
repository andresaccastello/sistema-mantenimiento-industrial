/**
 * Tareas de rutina (Etapa RT1, D-033): lógica pura de "Tareas de hoy" (sección 4).
 * Las fechas sin hora (`YYYY-MM-DD`) se leen por año, mes y día, sin pasar por la zona horaria.
 */
import type { FrecuenciaRutina, Persona, RegistroRutina, RutinaHoy } from '../api/tipos';

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
