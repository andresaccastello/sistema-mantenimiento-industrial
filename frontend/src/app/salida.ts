/**
 * Confirmar antes de salir de una pantalla con datos sin guardar (LE1, 4.2).
 *
 * La app usa BrowserRouter, que no tiene useBlocker. Una pantalla registra una guardia que
 * devuelve el texto de la pregunta, o null si no hay nada sin guardar; el menú, la campana y
 * los enlaces de la pantalla preguntan antes de navegar. Cerrar o recargar la pestaña lo
 * cubre `beforeunload`, con el texto del navegador.
 */

type Guardia = () => string | null;

let guardia: Guardia | null = null;

/** Registra la guardia de la pantalla; devuelve la función que la saca. */
export function registrarGuardiaSalida(fn: Guardia): () => void {
  guardia = fn;
  return () => {
    if (guardia === fn) guardia = null;
  };
}

/** true si se puede salir: sin nada pendiente, o si la persona confirma. */
export function confirmarSalida(): boolean {
  const pregunta = guardia ? guardia() : null;
  return pregunta === null || window.confirm(pregunta);
}
