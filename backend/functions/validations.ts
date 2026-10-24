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
  return c.json({ error: message }, 400);
};
