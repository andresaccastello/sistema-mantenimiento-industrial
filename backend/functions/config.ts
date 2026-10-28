if (!process.env.JWT_SECRET) {
  console.error("FATAL ERROR: JWT_SECRET no está definida en las variables de entorno.");
  process.exit(1);
}

export const JWT_SECRET = process.env.JWT_SECRET;
