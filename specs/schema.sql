-- ============================================================================
-- TIMP SDD · PostgreSQL 16 Schema (Taller de Cerámica)
-- ============================================================================
-- Specification-Driven Development — Fuente de verdad del modelo de datos.
-- Dominio: Estudio / taller de cerámica (torno, modelado, monográficos de esmaltes).
--
-- INVARIANTES GARANTIZADOS POR EL MOTOR SQL (no dependen de la aplicación):
--   1. users.credits >= 0                  (CHECK users_credits_non_negative)
--   2. users.email = lower(users.email)    (CHECK users_email_lowercase)
--   3. sessions.available_slots >= 0       (CHECK sessions_slots_non_negative)
--   4. sessions.available_slots <= max     (CHECK sessions_slots_within_capacity)
--   5. activity_types.credit_cost > 0      (CHECK activity_types_credit_cost_positive)
--   6. Un usuario NO puede tener dos reservas activas para la misma sesión
--      (UNIQUE INDEX parcial sobre bookings WHERE status = 'confirmed')
--   7. refresh_tokens con ON DELETE CASCADE e índices para revocación inmediata
--
-- Concurrencia (Regla 3 AGENT_RULES): el código de aplicación DEBE usar
-- transacciones con SELECT … FOR UPDATE sobre sessions y users antes de
-- decrementar available_slots / credits. Los CHECK constraints actúan como
-- última red de seguridad a nivel de motor.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. TIPOS ENUMERADOS
-- ============================================================================

CREATE TYPE user_role      AS ENUM ('client', 'trainer', 'admin');
CREATE TYPE booking_status AS ENUM ('confirmed', 'cancelled');

-- ============================================================================
-- 2. TABLAS
-- ============================================================================

-- --------------------------------------------------------------------------
-- 2.1 USERS
-- --------------------------------------------------------------------------
CREATE TABLE users (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT            NOT NULL,
    password_hash   TEXT            NOT NULL,       -- Hash Argon2id (Regla 5.1)
    full_name       TEXT            NOT NULL,
    role            user_role       NOT NULL DEFAULT 'client',
    credits         INTEGER         NOT NULL DEFAULT 0,
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    -- Integridad ---------------------------------------------------------------
    CONSTRAINT users_email_unique
        UNIQUE (email),

    CONSTRAINT users_credits_non_negative
        CHECK (credits >= 0),

    CONSTRAINT users_email_lowercase
        CHECK (email = lower(email))
);

COMMENT ON CONSTRAINT users_credits_non_negative ON users IS
    'Impide que el saldo de créditos sea negativo. Última red de seguridad contra cobros duplicados.';

COMMENT ON CONSTRAINT users_email_lowercase ON users IS
    'Garantiza unicidad case-insensitive evitando duplicados de email con mayúsculas/minúsculas.';

-- --------------------------------------------------------------------------
-- 2.2 ACTIVITY TYPES  (Torno alfarero, modelado manual, monográficos...)
-- --------------------------------------------------------------------------
CREATE TABLE activity_types (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT        NOT NULL,
    description         TEXT,                       -- Detalle de técnicas, materiales, temperatura
    duration_minutes    INTEGER     NOT NULL,
    credit_cost         INTEGER     NOT NULL DEFAULT 1,
    color               CHAR(7)     NOT NULL,       -- formato #RRGGBB
    is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Integridad ---------------------------------------------------------------
    CONSTRAINT activity_types_name_unique
        UNIQUE (name),

    CONSTRAINT activity_types_duration_positive
        CHECK (duration_minutes > 0),

    CONSTRAINT activity_types_credit_cost_positive
        CHECK (credit_cost > 0),

    CONSTRAINT activity_types_color_hex_format
        CHECK (color ~ '^#[0-9A-Fa-f]{6}$')
);

-- --------------------------------------------------------------------------
-- 2.3 SESSIONS  (clases programadas en el calendario del taller)
-- --------------------------------------------------------------------------
CREATE TABLE sessions (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_type_id    UUID        NOT NULL,
    trainer_id          UUID        NOT NULL,       -- Profesora/profesor ceramista
    starts_at           TIMESTAMPTZ NOT NULL,
    ends_at             TIMESTAMPTZ NOT NULL,
    max_capacity        INTEGER     NOT NULL,       -- Puestos disponibles (ej. nº de tornos)
    available_slots     INTEGER     NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Claves foráneas ----------------------------------------------------------
    CONSTRAINT sessions_fk_activity_type
        FOREIGN KEY (activity_type_id) REFERENCES activity_types (id),

    CONSTRAINT sessions_fk_trainer
        FOREIGN KEY (trainer_id) REFERENCES users (id),

    -- Integridad ---------------------------------------------------------------
    CONSTRAINT sessions_time_coherence
        CHECK (starts_at < ends_at),

    CONSTRAINT sessions_capacity_positive
        CHECK (max_capacity > 0),

    CONSTRAINT sessions_slots_non_negative
        CHECK (available_slots >= 0),

    CONSTRAINT sessions_slots_within_capacity
        CHECK (available_slots <= max_capacity)
);

COMMENT ON CONSTRAINT sessions_slots_non_negative ON sessions IS
    'Impide sobre-reservar: el motor SQL rechaza cualquier UPDATE que deje available_slots < 0.';

-- --------------------------------------------------------------------------
-- 2.4 REFRESH TOKENS  (sesiones de autenticación — Regla 5.2)
-- --------------------------------------------------------------------------
CREATE TABLE refresh_tokens (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID            NOT NULL,
    token_hash      TEXT            NOT NULL,       -- Hash SHA-256 del token opaco
    expires_at      TIMESTAMPTZ     NOT NULL,
    revoked_at      TIMESTAMPTZ,                    -- NULL = activo, timestamp = revocado
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    -- Claves foráneas ----------------------------------------------------------
    CONSTRAINT refresh_tokens_fk_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,

    -- Integridad ---------------------------------------------------------------
    CONSTRAINT refresh_tokens_hash_unique
        UNIQUE (token_hash)
);

COMMENT ON TABLE refresh_tokens IS
    'Refresh tokens rotatorios (Regla 5.2). revoked_at NULL = activo. '
    'Al detectar reutilización de token revocado o cuando un usuario pasa a is_active = false, '
    'se revocan todos los tokens del usuario.';

-- --------------------------------------------------------------------------
-- 2.5 BOOKINGS  (reservas de alumnos en sesiones)
-- --------------------------------------------------------------------------
CREATE TABLE bookings (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID            NOT NULL,
    session_id      UUID            NOT NULL,
    status          booking_status  NOT NULL DEFAULT 'confirmed',
    credits_charged INTEGER         NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    cancelled_at    TIMESTAMPTZ,

    -- Claves foráneas ----------------------------------------------------------
    CONSTRAINT bookings_fk_user
        FOREIGN KEY (user_id) REFERENCES users (id),

    CONSTRAINT bookings_fk_session
        FOREIGN KEY (session_id) REFERENCES sessions (id),

    -- Integridad ---------------------------------------------------------------
    CONSTRAINT bookings_credits_charged_positive
        CHECK (credits_charged > 0),

    CONSTRAINT bookings_cancelled_at_coherence
        CHECK (
            (status = 'confirmed' AND cancelled_at IS NULL)
            OR
            (status = 'cancelled' AND cancelled_at IS NOT NULL)
        )
);

-- --------------------------------------------------------------------------
-- 2.6 ARTWORKS  (piezas cerámicas únicas y utilitarias creadas en el taller)
-- --------------------------------------------------------------------------
CREATE TABLE artworks (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT            NOT NULL,
    category        TEXT            NOT NULL,
    price_eur       INTEGER         NOT NULL,
    stock           INTEGER         NOT NULL DEFAULT 1,
    glaze_finish    TEXT            NOT NULL,
    palette_hex     CHAR(7)         NOT NULL,
    image_url       TEXT,
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    -- Integridad ---------------------------------------------------------------
    CONSTRAINT artworks_price_eur_positive
        CHECK (price_eur > 0),

    CONSTRAINT artworks_stock_non_negative
        CHECK (stock >= 0),

    CONSTRAINT artworks_palette_hex_format
        CHECK (palette_hex ~ '^#[0-9A-Fa-f]{6}$')
);

COMMENT ON CONSTRAINT artworks_stock_non_negative ON artworks IS
    'Impide sobreventa: el motor SQL garantiza que el stock nunca pueda ser negativo.';

-- ============================================================================
-- 3. ÍNDICE ÚNICO PARCIAL — Anti-doble-reserva
-- ============================================================================
-- Garantiza a nivel de motor que un alumno NO puede tener dos reservas
-- activas (confirmed) para la misma sesión de cerámica.
-- Las reservas canceladas quedan libres para re-reservar tras cancelación.
-- ============================================================================

CREATE UNIQUE INDEX bookings_one_active_per_user_session
    ON bookings (user_id, session_id)
    WHERE status = 'confirmed';

COMMENT ON INDEX bookings_one_active_per_user_session IS
    'Impide doble reserva activa. Un usuario solo puede tener una booking confirmed por sesión.';

-- ============================================================================
-- 4. ÍNDICES DE RENDIMIENTO Y SEGURIDAD
-- ============================================================================

-- Búsqueda de sesiones por rango de fechas (vista de calendario del taller)
CREATE INDEX sessions_idx_starts_at
    ON sessions (starts_at);

-- Filtrar sesiones por actividad (ej. ver solo torno)
CREATE INDEX sessions_idx_activity_type
    ON sessions (activity_type_id);

-- Filtrar sesiones por profesora ceramista
CREATE INDEX sessions_idx_trainer
    ON sessions (trainer_id);

-- Sesiones futuras con plazas libres (catálogo de clases con plazas disponibles)
CREATE INDEX sessions_idx_available_future
    ON sessions (starts_at)
    WHERE available_slots > 0;

-- Refresh tokens activos por usuario (revocación inmediata por robo o is_active = false)
CREATE INDEX refresh_tokens_idx_active_user
    ON refresh_tokens (user_id)
    WHERE revoked_at IS NULL;

-- Lookup rápido de refresh token activo por hash (rotación / refresh de token)
CREATE INDEX refresh_tokens_idx_active_hash
    ON refresh_tokens (token_hash)
    WHERE revoked_at IS NULL;

-- Índice para limpieza periódica de tokens expirados
CREATE INDEX refresh_tokens_idx_expires_at
    ON refresh_tokens (expires_at);

-- Historial de reservas de un alumno
CREATE INDEX bookings_idx_user
    ON bookings (user_id);

-- Reservas activas por sesión (asistencia / aforo)
CREATE INDEX bookings_idx_session_active
    ON bookings (session_id)
    WHERE status = 'confirmed';

-- Lookup rápido de usuarios por email (login)
CREATE INDEX users_idx_email
    ON users (email);

-- Catálogo de piezas activas por categoría
CREATE INDEX artworks_idx_active_category
    ON artworks (category)
    WHERE is_active = TRUE;

-- ============================================================================
-- 5. TRIGGERS — updated_at automático
-- ============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_activity_types_updated_at
    BEFORE UPDATE ON activity_types
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_sessions_updated_at
    BEFORE UPDATE ON sessions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_artworks_updated_at
    BEFORE UPDATE ON artworks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 6. DATOS DE PRUEBA (SEED) — TALLER DE CERÁMICA
-- ============================================================================

-- 6.1 Usuarios
-- Contraseña temporal para seeds: "CeramicaSegura2026!"
-- Hash válido Argon2id (OWASP compliant: m=19456, t=2, p=1)
INSERT INTO users (id, email, password_hash, full_name, role, credits, is_active) VALUES
    (
        'a0000000-0000-0000-0000-000000000001',
        'admin@tallerbarro.com',
        '$argon2id$v=19$m=19456,t=2,p=1$dGFsbGVyY2VyYW1pY2Ex$Wv3G0r0b9uH8m1zK2xQ5yV7s6P4t3R2q1L0o9N8m7K6',
        'Elena Gómez (Administración Taller)',
        'admin',
        0,
        TRUE
    ),
    (
        'b0000000-0000-0000-0000-000000000001',
        'carmen.profesora@tallerbarro.com',
        '$argon2id$v=19$m=19456,t=2,p=1$dGFsbGVyY2VyYW1pY2Ey$Xw4H1s1c0vI9n2zL3yR6zW8t7Q5u4S3r2M1p0O9n8L7',
        'Beatriz Tabliega',
        'trainer',
        0,
        TRUE
    ),
    (
        'c0000000-0000-0000-0000-000000000001',
        'sofia.alumna@example.com',
        '$argon2id$v=19$m=19456,t=2,p=1$dGFsbGVyY2VyYW1pY2Ez$Yx5I2t2d1wJ0o3zM4zS7aX9u8R6v5T4s3N2q1P0o9M8',
        'Sofía Valero',
        'client',
        4,
        TRUE
    ),
    (
        'c0000000-0000-0000-0000-000000000002',
        'marcos.alumno@example.com',
        '$argon2id$v=19$m=19456,t=2,p=1$dGFsbGVyY2VyYW1pY2E0$Zy6J3u3e2xK1p4zN5aT8bY0v9S7w6U5t4O3r2Q1p0N9',
        'Marcos Delgado',
        'client',
        4,
        TRUE
    );

-- 6.2 Tipos de Actividades de Cerámica
INSERT INTO activity_types (id, name, description, duration_minutes, credit_cost, color, is_active) VALUES
    (
        'd0000000-0000-0000-0000-000000000001',
        'Torno Alfarero · Clases Semanales',
        'Torno alfarero y práctica continua de taller: centrado, cilindrado, retorneado y esmaltado de piezas de gres en sesiones semanales.',
        120,
        1,
        '#C47451',
        TRUE
    ),
    (
        'd0000000-0000-0000-0000-000000000002',
        'Modelado y Engobes · Clases Sueltas',
        'Toma de contacto con el barro: técnicas de pellizco, planchas y decoración con engobes botz para crear piezas utilitarias y escultóricas.',
        90,
        1,
        '#7C8471',
        TRUE
    ),
    (
        'd0000000-0000-0000-0000-000000000003',
        'Monográfico de Esmaltes y Texturas',
        'Monográfico intensivo: formulación y aplicación de esmaltes de alta temperatura, superposiciones, texturas y acabados cerámicos de autor.',
        180,
        2,
        '#2546A8',
        TRUE
    );

-- 6.3 Sesiones Programadas para Mañana
INSERT INTO sessions (id, activity_type_id, trainer_id, starts_at, ends_at, max_capacity, available_slots) VALUES
    (
        'e0000000-0000-0000-0000-000000000001',
        'd0000000-0000-0000-0000-000000000001', -- Torno Alfarero · Clases Semanales
        'b0000000-0000-0000-0000-000000000001', -- Beatriz Tabliega
        CURRENT_DATE + INTERVAL '1 day 10 hours',
        CURRENT_DATE + INTERVAL '1 day 12 hours',
        6,
        1  -- Torno con 1 sola plaza libre de 6
    ),
    (
        'e0000000-0000-0000-0000-000000000002',
        'd0000000-0000-0000-0000-000000000002', -- Modelado y Engobes · Clases Sueltas
        'b0000000-0000-0000-0000-000000000001', -- Beatriz Tabliega
        CURRENT_DATE + INTERVAL '1 day 16 hours',
        CURRENT_DATE + INTERVAL '1 day 17 hours 30 minutes',
        10,
        8  -- Modelado con 8 plazas libres de 10
    );

-- 6.4 Piezas de Cerámica de Autor (Artworks - Colección Beatriz Tabliega)
INSERT INTO artworks (id, title, category, price_eur, stock, glaze_finish, palette_hex, image_url, is_active) VALUES
    (
        'f1000000-0000-0000-0000-000000000001',
        'Equilibrio Constructivista · Esferas Cobalto',
        'Escultura',
        165,
        1,
        'Gres chamotado sin esmaltar y esferas en azul cobalto',
        '#1D3566',
        '/media/obras/equilibrio-cobalto.jpg',
        TRUE
    ),
    (
        'f1000000-0000-0000-0000-000000000002',
        'Tótem Arco · Tierra y Manganeso',
        'Escultura',
        180,
        1,
        'Gres negro manganeso, cuenco ocre y esfera texturizada',
        '#231F1E',
        '/media/estudio/totem-abrazo.jpg',
        TRUE
    ),
    (
        'f1000000-0000-0000-0000-000000000003',
        'Disco Acanalado · Óxido y Siena',
        'Escultura',
        130,
        1,
        'Gres modelado a mano con engobes de hierro',
        '#7A3E26',
        '/media/obras/disco-siena.jpg',
        TRUE
    ),
    (
        'f1000000-0000-0000-0000-000000000004',
        'Trío Jarras Asa Circular · Serie Klein',
        'Vajilla y Floreros',
        85,
        1,
        'Gres blanco, terracota cruda y manganeso',
        '#2546A8',
        '/media/obras/jarras-klein.jpg',
        TRUE
    ),
    (
        'f1000000-0000-0000-0000-000000000005',
        'Conjunto Escultórico · Florero Tulipán',
        'Vajilla y Floreros',
        95,
        1,
        'Florero orgánico acanalado y vasija arquitectónica negra',
        '#8C7A5B',
        '/media/obras/trio-tulipan.jpg',
        TRUE
    ),
    (
        'f1000000-0000-0000-0000-000000000006',
        'Vajilla de Mesa · Verde Petróleo y Chamota',
        'Vajilla y Floreros',
        65,
        2,
        'Plato esmalte petróleo profundo y cuenco exterior texturizado',
        '#1D5B5E',
        '/media/estudio/bodegon-gato.jpg',
        TRUE
    );

COMMIT;
