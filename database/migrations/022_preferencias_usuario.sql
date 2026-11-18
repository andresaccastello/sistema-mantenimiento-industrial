-- database/migrations/022_preferencias_usuario.sql
-- Etapa D1: preferencias de cada usuario (D-031)
BEGIN;

-- 1. El modo simple en el celular (TRUE: lo de hoy, así nadie ve un cambio hasta que lo apague)
-- y el tema (SISTEMA sigue lo que tenga elegido el dispositivo).
ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS modo_simple_celular BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS tema VARCHAR(10) NOT NULL DEFAULT 'CLARO';

ALTER TABLE usuarios
    DROP CONSTRAINT IF EXISTS ck_usuarios_tema;

ALTER TABLE usuarios
    ADD CONSTRAINT ck_usuarios_tema
    CHECK (tema IN ('CLARO', 'OSCURO', 'SISTEMA'));

COMMIT;
