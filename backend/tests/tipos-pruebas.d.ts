/**
 * L1, 2: solo para el typecheck de las pruebas (backend/tsconfig.tests.json).
 *
 * Las pruebas leen el cuerpo de las respuestas con `await res.json()`, y en los tipos de Node
 * eso es `Promise<unknown>`. Las pruebas no tipan cada respuesta: comparan sus campos con
 * assert. Por eso, solo acá, el cuerpo es `any`. Lo que este typecheck controla es que las
 * pruebas usen bien las funciones del backend que importan.
 *
 * No cambia nada al correr: es una declaración de tipos, y tsconfig.json (el del backend) no
 * la incluye.
 */
interface Response {
  json(): Promise<any>;
}
