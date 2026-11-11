-- database/migrations/019_vencimientos.sql
-- Etapa PV5: generación automática y avisos de vencimiento (D-025)
BEGIN;

-- 1. El usuario del sistema (2.1): el autor de lo automático
ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS es_sistema BOOLEAN NOT NULL DEFAULT FALSE;

-- Uno solo
CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_es_sistema
    ON usuarios (es_sistema)
    WHERE es_sistema;

-- Si ya hay un legajo SISTEMA que no es el del sistema, la migración falla y no corrige nada
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM usuarios WHERE legajo = 'SISTEMA' AND NOT es_sistema) THEN
        RAISE EXCEPTION 'Ya existe un usuario con legajo SISTEMA que no es el del sistema. Revisarlo antes de migrar.';
    END IF;
END
$$;

-- Inactivo, con perfil CONSULTA y una contraseña imposible: un hash al azar que no es de
-- bcrypt, así que no corresponde a ninguna clave. Solo se crea la primera vez.
INSERT INTO usuarios (legajo, nombre, apellido, password_hash, perfil_id, activo, es_sistema)
SELECT 'SISTEMA', 'Sistema', NULL, '!' || md5(random()::text || clock_timestamp()::text), p.id, FALSE, TRUE
FROM perfiles p
WHERE p.nombre = 'CONSULTA'
  AND NOT EXISTS (SELECT 1 FROM usuarios WHERE es_sistema);

-- 2. El plan (2.2)
ALTER TABLE planes_mantenimiento
    ADD COLUMN IF NOT EXISTS generacion_automatica BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Los avisos ya dados (2.3): uno por tarea, estado y ciclo
CREATE TABLE IF NOT EXISTS avisos_vencimiento (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plan_tarea_id BIGINT NOT NULL REFERENCES plan_tareas(id),
    estado VARCHAR(10) NOT NULL,
    ciclo VARCHAR(40) NOT NULL,
    avisado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE avisos_vencimiento
    DROP CONSTRAINT IF EXISTS ck_avisos_vencimiento_estado;

ALTER TABLE avisos_vencimiento
    ADD CONSTRAINT ck_avisos_vencimiento_estado
    CHECK (estado IN ('PROXIMA', 'VENCIDA'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_avisos_vencimiento_tarea_estado_ciclo
    ON avisos_vencimiento (plan_tarea_id, estado, ciclo);

-- 4. La última revisión del día (2.4)
ALTER TABLE configuracion_sistema
    ADD COLUMN IF NOT EXISTS vencimientos_revisados_el DATE NULL;

COMMIT;
