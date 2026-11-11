-- Migración 010: Control de versiones de sesión en usuarios
-- Agrega usuarios.sesion_version para invalidación instantánea y determinista de tokens JWT.

ALTER TABLE usuarios 
ADD COLUMN IF NOT EXISTS sesion_version INTEGER NOT NULL DEFAULT 1;
