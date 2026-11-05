import { Context } from 'hono';

export const parseId = (idStr: string): number | null => {
  const num = Number(idStr);
  return (!isNaN(num) && num > 0 && Number.isInteger(num)) ? num : null;
};

export const parseString = (val: any): string | null => {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const badRequest = (c: Context, message: string) => {
  return c.json({ error: message, codigo: 'DATOS_INVALIDOS' }, 400);
};

export const leerCuerpoObjeto = async (
  c: Context
): Promise<{ ok: true; body: Record<string, any> } | { ok: false; response: Response }> => {
  let raw: any;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, response: badRequest(c, 'El cuerpo de la solicitud debe ser un objeto JSON') };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, response: badRequest(c, 'El cuerpo de la solicitud debe ser un objeto JSON') };
  }
  return { ok: true, body: raw };
};
