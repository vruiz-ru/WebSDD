import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

export interface DbUserRecord {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  role: 'client' | 'trainer' | 'admin';
  credits: number;
  is_active: boolean;
}

export interface DbActivityRecord {
  id: string;
  name: string;
  description: string;
  duration_minutes: number;
  credit_cost: number;
  color: string;
  is_active: boolean;
}

export interface DbSessionRecord {
  id: string;
  activity_type_id: string;
  trainer_id: string;
  starts_at: string;
  ends_at: string;
  max_capacity: number;
  available_slots: number;
}

export interface DbBookingRecord {
  id: string;
  user_id: string;
  session_id: string;
  status: 'confirmed' | 'cancelled';
  credits_charged: number;
  created_at: string;
  cancelled_at: string | null;
}

export interface DbArtworkRecord {
  id: string;
  title: string;
  category: string;
  price_eur: number;
  stock: number;
  glaze_finish: string;
  palette_hex: string;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DbRefreshTokenRecord {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: string;
}

/**
 * Mutex para simular el bloqueo de fila pesimista (SELECT ... FOR UPDATE)
 * de PostgreSQL en memoria cuando no hay contenedor Docker activo.
 */
class RowLock {
  private locked = false;
  private queue: (() => void)[] = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) next();
    } else {
      this.locked = false;
    }
  }
}

/**
 * Base de datos en memoria inicializada estrictamente con los datos Seed
 * definidos en specs/schema.sql para permitir desarrollo y testing ágil
 * sin depender obligatoriamente de un daemon de Docker externo.
 */
export function createInMemoryPool(): pg.Pool {
  const sessionLock = new RowLock();
  const artworkLock = new RowLock();
  const userLock = new RowLock();
  const bookingLock = new RowLock();

  // Hash Argon2id válido para la contraseña 'CeramicaSegura2026!'
  const defaultPasswordHash =
    '$argon2id$v=19$m=65536,t=3,p=4$bGU7ZgbEnidI4H09q6uOxg$6bK8V3a56TWBJHNDpG0JJRkeWh1iEfhjRSmuc0nzSBE';

  const users: DbUserRecord[] = [
    {
      id: 'a0000000-0000-0000-0000-000000000001',
      email: 'admin@tallerbarro.com',
      password_hash: defaultPasswordHash,
      full_name: 'Elena Gómez (Administración Taller)',
      role: 'admin',
      credits: 0,
      is_active: true,
    },
    {
      id: 'b0000000-0000-0000-0000-000000000001',
      email: 'carmen.profesora@tallerbarro.com',
      password_hash: defaultPasswordHash,
      full_name: 'Beatriz Tabliega',
      role: 'trainer',
      credits: 0,
      is_active: true,
    },
    {
      id: 'c0000000-0000-0000-0000-000000000001',
      email: 'sofia.alumna@example.com',
      password_hash: defaultPasswordHash,
      full_name: 'Sofía Valero',
      role: 'client',
      credits: 4,
      is_active: true,
    },
    {
      id: 'c0000000-0000-0000-0000-000000000002',
      email: 'marcos.alumno@example.com',
      password_hash: defaultPasswordHash,
      full_name: 'Marcos Delgado',
      role: 'client',
      credits: 4,
      is_active: true,
    },
  ];

  const activities: DbActivityRecord[] = [
    {
      id: 'd0000000-0000-0000-0000-000000000001',
      name: 'Torno Alfarero · Clases Semanales',
      description:
        'Torno alfarero y práctica continua de taller: centrado, cilindrado, retorneado y esmaltado de piezas de gres en sesiones semanales.',
      duration_minutes: 120,
      credit_cost: 1,
      color: '#C47451',
      is_active: true,
    },
    {
      id: 'd0000000-0000-0000-0000-000000000002',
      name: 'Modelado y Engobes · Clases Sueltas',
      description:
        'Toma de contacto con el barro: técnicas de pellizco, planchas y decoración con engobes botz para crear piezas utilitarias y escultóricas.',
      duration_minutes: 90,
      credit_cost: 1,
      color: '#7C8471',
      is_active: true,
    },
    {
      id: 'd0000000-0000-0000-0000-000000000003',
      name: 'Monográfico de Esmaltes y Texturas',
      description:
        'Monográfico intensivo: formulación y aplicación de esmaltes de alta temperatura, superposiciones, texturas y acabados cerámicos de autor.',
      duration_minutes: 180,
      credit_cost: 2,
      color: '#2546A8',
      is_active: true,
    },
  ];

  // Fechas dinámicas para mañana según seed de specs/schema.sql
  const now = new Date();
  const tomorrow10 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 10, 0, 0);
  const tomorrow12 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12, 0, 0);
  const tomorrow16 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 16, 0, 0);
  const tomorrow1730 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 17, 30, 0);
  const dayAfterTomorrow11 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 11, 0, 0);
  const dayAfterTomorrow14 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 14, 0, 0);
  const inThreeDays17 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 17, 0, 0);
  const inThreeDays19 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 19, 0, 0);

  const sessions: DbSessionRecord[] = [
    {
      id: 'e0000000-0000-0000-0000-000000000001',
      activity_type_id: 'd0000000-0000-0000-0000-000000000001',
      trainer_id: 'b0000000-0000-0000-0000-000000000001',
      starts_at: tomorrow10.toISOString(),
      ends_at: tomorrow12.toISOString(),
      max_capacity: 6,
      available_slots: 1, // 1 plaza libre de 6
    },
    {
      id: 'e0000000-0000-0000-0000-000000000002',
      activity_type_id: 'd0000000-0000-0000-0000-000000000002',
      trainer_id: 'b0000000-0000-0000-0000-000000000001',
      starts_at: tomorrow16.toISOString(),
      ends_at: tomorrow1730.toISOString(),
      max_capacity: 10,
      available_slots: 8, // 8 plazas libres de 10
    },
    {
      id: 'e0000000-0000-0000-0000-000000000003',
      activity_type_id: 'd0000000-0000-0000-0000-000000000003', // Monográfico de Esmaltes y Texturas
      trainer_id: 'b0000000-0000-0000-0000-000000000001',
      starts_at: dayAfterTomorrow11.toISOString(),
      ends_at: dayAfterTomorrow14.toISOString(),
      max_capacity: 8,
      available_slots: 6,
    },
    {
      id: 'e0000000-0000-0000-0000-000000000004',
      activity_type_id: 'd0000000-0000-0000-0000-000000000001', // Torno Alfarero · Clases Semanales
      trainer_id: 'b0000000-0000-0000-0000-000000000001',
      starts_at: inThreeDays17.toISOString(),
      ends_at: inThreeDays19.toISOString(),
      max_capacity: 6,
      available_slots: 5,
    },
  ];

  const refreshTokens: DbRefreshTokenRecord[] = [];
  const bookings: DbBookingRecord[] = [
    {
      id: 'f0000000-0000-0000-0000-000000000001',
      user_id: 'c0000000-0000-0000-0000-000000000001',
      session_id: 'e0000000-0000-0000-0000-000000000001',
      status: 'confirmed',
      credits_charged: 1,
      created_at: new Date().toISOString(),
      cancelled_at: null,
    },
  ];

  const artworks: DbArtworkRecord[] = [
    {
      id: 'f1000000-0000-0000-0000-000000000001',
      title: 'Equilibrio Constructivista · Esferas Cobalto',
      category: 'Escultura',
      price_eur: 165,
      stock: 1,
      glaze_finish: 'Gres chamotado sin esmaltar y esferas en azul cobalto',
      palette_hex: '#1D3566',
      image_url: '/media/obras/equilibrio-cobalto.jpg',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'f1000000-0000-0000-0000-000000000002',
      title: 'Tótem Arco · Tierra y Manganeso',
      category: 'Escultura',
      price_eur: 180,
      stock: 1,
      glaze_finish: 'Gres negro manganeso, cuenco ocre y esfera texturizada',
      palette_hex: '#231F1E',
      image_url: '/media/estudio/totem-abrazo.jpg',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'f1000000-0000-0000-0000-000000000003',
      title: 'Disco Acanalado · Óxido y Siena',
      category: 'Escultura',
      price_eur: 130,
      stock: 1,
      glaze_finish: 'Gres modelado a mano con engobes de hierro',
      palette_hex: '#7A3E26',
      image_url: '/media/obras/disco-siena.jpg',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'f1000000-0000-0000-0000-000000000004',
      title: 'Trío Jarras Asa Circular · Serie Klein',
      category: 'Vajilla y Floreros',
      price_eur: 85,
      stock: 1,
      glaze_finish: 'Gres blanco, terracota cruda y manganeso',
      palette_hex: '#2546A8',
      image_url: '/media/obras/jarras-klein.jpg',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'f1000000-0000-0000-0000-000000000005',
      title: 'Conjunto Escultórico · Florero Tulipán',
      category: 'Vajilla y Floreros',
      price_eur: 95,
      stock: 1,
      glaze_finish: 'Florero orgánico acanalado y vasija arquitectónica negra',
      palette_hex: '#8C7A5B',
      image_url: '/media/obras/trio-tulipan.jpg',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'f1000000-0000-0000-0000-000000000006',
      title: 'Vajilla de Mesa · Verde Petróleo y Chamota',
      category: 'Vajilla y Floreros',
      price_eur: 65,
      stock: 2,
      glaze_finish: 'Plato esmalte petróleo profundo y cuenco exterior texturizado',
      palette_hex: '#1D5B5E',
      image_url: '/media/estudio/bodegon-gato.jpg',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const executeQuery = async (sql: string, params?: unknown[]) => {
    // 1. SELECT 1 (Health check)
    if (sql.trim().toUpperCase() === 'SELECT 1' || sql.trim().toUpperCase() === 'SELECT 1;') {
      return { rows: [{ '?column?': 1 }], rowCount: 1 };
    }

    // 2. SELECT ... FOR UPDATE sobre sessions
    if (sql.includes('FOR UPDATE OF s')) {
      await sessionLock.acquire();
      const sessionId = String(params?.[0]);
      const s = sessions.find((x) => x.id === sessionId);
      if (!s) return { rows: [], rowCount: 0 };

      const at = activities.find((a) => a.id === s.activity_type_id);
      return {
        rows: [
          {
            id: s.id,
            max_capacity: s.max_capacity,
            available_slots: s.available_slots,
            credit_cost: at?.credit_cost ?? 1,
          },
        ],
        rowCount: 1,
      };
    }

    // 3. Consulta de sesiones para el calendario (GET /api/v1/sessions)
    if (sql.includes('FROM activity_types') && !sql.includes('JOIN')) {
      const activeActivities = activities.filter((a) => a.is_active);
      return {
        rows: activeActivities.map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          duration_minutes: a.duration_minutes,
          credit_cost: a.credit_cost,
          color: a.color,
        })),
        rowCount: activeActivities.length,
      };
    }

    if (sql.includes('FROM sessions s') && sql.includes('WHERE s.id = $1')) {
      const sessionId = String(params?.[0]);
      const s = sessions.find((x) => x.id === sessionId);
      if (!s) return { rows: [], rowCount: 0 };
      const at = activities.find((a) => a.id === s.activity_type_id);
      const tr = users.find((u) => u.id === s.trainer_id);
      return {
        rows: [
          {
            session_id: s.id,
            starts_at: s.starts_at,
            ends_at: s.ends_at,
            max_capacity: s.max_capacity,
            available_slots: s.available_slots,
            activity_id: at?.id ?? '',
            activity_name: at?.name ?? '',
            activity_description: at?.description ?? '',
            activity_duration: at?.duration_minutes ?? 0,
            activity_credit_cost: at?.credit_cost ?? 1,
            activity_color: at?.color ?? '#C17A56',
            trainer_id: tr?.id ?? '',
            trainer_name: tr?.full_name ?? '',
          },
        ],
        rowCount: 1,
      };
    }

    if (sql.includes('INSERT INTO sessions')) {
      const activityTypeId = String(params?.[0]);
      const trainerId = String(params?.[1]);
      const startsAt = new Date(String(params?.[2])).toISOString();
      const endsAt = new Date(String(params?.[3])).toISOString();
      const maxCapacity = Number(params?.[4]);
      const availableSlots = Number(params?.[5] ?? maxCapacity);
      const newId = randomUUID();
      sessions.push({
        id: newId,
        activity_type_id: activityTypeId,
        trainer_id: trainerId,
        starts_at: startsAt,
        ends_at: endsAt,
        max_capacity: maxCapacity,
        available_slots: availableSlots,
      });
      return { rows: [{ id: newId }], rowCount: 1 };
    }

    if (sql.includes('FROM users') && sql.includes("role = 'client'")) {
      const clients = users.filter((u) => u.role === 'client' && u.is_active);
      return {
        rows: clients.map((u) => ({
          id: u.id,
          full_name: u.full_name,
          email: u.email,
          credits: u.credits,
        })),
        rowCount: clients.length,
      };
    }

    if (sql.includes('FROM sessions s') && sql.includes('JOIN activity_types at')) {
      const fromParam = params?.[0] ? new Date(String(params[0])).getTime() : 0;
      const toParam = params?.[1] ? new Date(String(params[1])).getTime() : Infinity;
      const activityIdParam = params?.[2] ? String(params[2]) : null;

      const filtered = sessions
        .filter((s) => {
          const sTime = new Date(s.starts_at).getTime();
          const inRange = sTime >= fromParam && sTime <= toParam;
          const matchesActivity = !activityIdParam || s.activity_type_id === activityIdParam;
          return inRange && matchesActivity;
        })
        .map((s) => {
          const at = activities.find((a) => a.id === s.activity_type_id);
          const tr = users.find((u) => u.id === s.trainer_id);
          return {
            session_id: s.id,
            starts_at: s.starts_at,
            ends_at: s.ends_at,
            max_capacity: s.max_capacity,
            available_slots: s.available_slots,
            activity_id: at?.id ?? '',
            activity_name: at?.name ?? '',
            activity_description: at?.description ?? '',
            activity_duration: at?.duration_minutes ?? 0,
            activity_credit_cost: at?.credit_cost ?? 1,
            activity_color: at?.color ?? '#C17A56',
            trainer_id: tr?.id ?? '',
            trainer_name: tr?.full_name ?? '',
          };
        });

      return { rows: filtered, rowCount: filtered.length };
    }

    // 3. Login: Lookup user by email
    if (sql.includes('FROM users WHERE email = $1')) {
      const email = String(params?.[0]).toLowerCase().trim();
      const u = users.find((x) => x.email.toLowerCase() === email);
      return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
    }

    // 4. Insert Refresh Token
    if (sql.includes('INSERT INTO refresh_tokens')) {
      const userId = String(params?.[0]);
      const tokenHash = String(params?.[1]);
      const expiresAt = new Date(String(params?.[2]));

      const record: DbRefreshTokenRecord = {
        id: `rt-${refreshTokens.length + 1}`,
        user_id: userId,
        token_hash: tokenHash,
        expires_at: expiresAt,
        revoked_at: null,
        created_at: new Date().toISOString(),
      };
      refreshTokens.push(record);
      return { rows: [record], rowCount: 1 };
    }

    // 5. Refresh token lookup by hash
    if (sql.includes('FROM refresh_tokens rt') && sql.includes('WHERE rt.token_hash = $1')) {
      const tokenHash = String(params?.[0]);
      const rt = refreshTokens.find((t) => t.token_hash === tokenHash);
      if (!rt) return { rows: [], rowCount: 0 };

      const u = users.find((x) => x.id === rt.user_id);
      return {
        rows: [
          {
            id: rt.id,
            user_id: rt.user_id,
            expires_at: rt.expires_at,
            revoked_at: rt.revoked_at,
            role: u?.role ?? 'client',
            is_active: u?.is_active ?? true,
          },
        ],
        rowCount: 1,
      };
    }

    // 6. Revocar todos los tokens de un usuario (detección de reutilización)
    if (sql.includes('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1')) {
      const userId = String(params?.[0]);
      let count = 0;
      for (const rt of refreshTokens) {
        if (rt.user_id === userId && rt.revoked_at === null) {
          rt.revoked_at = new Date();
          count++;
        }
      }
      return { rows: [], rowCount: count };
    }

    // 7. Revocar un token específico por id
    if (sql.includes('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1')) {
      const id = String(params?.[0]);
      const rt = refreshTokens.find((t) => t.id === id);
      if (rt) rt.revoked_at = new Date();
      return { rows: [], rowCount: rt ? 1 : 0 };
    }

    // 9. SELECT ... FOR UPDATE sobre users
    if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) {
      await userLock.acquire();
      const userId = String(params?.[0]);
      const u = users.find((x) => x.id === userId);
      return {
        rows: u ? [{ id: u.id, credits: u.credits, is_active: u.is_active, full_name: u.full_name, role: u.role }] : [],
        rowCount: u ? 1 : 0,
      };
    }

    // 10. Anti-doble reserva activa
    if (sql.includes('FROM bookings') && sql.includes('user_id = $1') && sql.includes('session_id = $2')) {
      const userId = String(params?.[0]);
      const sessionId = String(params?.[1]);
      const existing = bookings.filter(
        (b) => b.user_id === userId && b.session_id === sessionId && b.status === 'confirmed'
      );
      return { rows: existing, rowCount: existing.length };
    }

    // 11. Decrementar plaza en sessions
    if (sql.includes('UPDATE sessions') && sql.includes('available_slots = available_slots - 1')) {
      const sessionId = String(params?.[0]);
      const s = sessions.find((x) => x.id === sessionId);
      if (s) s.available_slots = Math.max(0, s.available_slots - 1);
      return { rows: [], rowCount: s ? 1 : 0 };
    }

    // 12. Decrementar créditos en users
    if (sql.includes('UPDATE users') && sql.includes('credits = credits - $1')) {
      const cost = Number(params?.[0]);
      const userId = String(params?.[1]);
      const u = users.find((x) => x.id === userId);
      if (u) u.credits = Math.max(0, u.credits - cost);
      return { rows: [], rowCount: u ? 1 : 0 };
    }

    // 13. Insertar reserva confirmada
    if (sql.includes('INSERT INTO bookings')) {
      const userId = String(params?.[0]);
      const sessionId = String(params?.[1]);
      const creditsCharged = Number(params?.[2]);

      const newId = randomUUID();
      const createdAt = new Date().toISOString();

      bookings.push({
        id: newId,
        user_id: userId,
        session_id: sessionId,
        status: 'confirmed',
        credits_charged: creditsCharged,
        created_at: createdAt,
        cancelled_at: null,
      });

      return {
        rows: [{ id: newId, created_at: createdAt }],
        rowCount: 1,
      };
    }

    // 14. Consulta de reservas del usuario (GET /api/v1/bookings/me)
    if (sql.includes('FROM bookings b') && sql.includes('JOIN sessions s') && sql.includes('WHERE b.user_id = $1')) {
      const userId = String(params?.[0]);
      const userBookings = bookings
        .filter((b) => b.user_id === userId)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .map((b) => {
          const s = sessions.find((item) => item.id === b.session_id);
          const at = activities.find((item) => item.id === s?.activity_type_id);
          const tr = users.find((item) => item.id === s?.trainer_id);
          return {
            booking_id: b.id,
            session_id: b.session_id,
            booking_status: b.status,
            credits_charged: b.credits_charged,
            booking_created_at: b.created_at,
            booking_cancelled_at: b.cancelled_at,
            starts_at: s?.starts_at ?? '',
            ends_at: s?.ends_at ?? '',
            max_capacity: s?.max_capacity ?? 0,
            available_slots: s?.available_slots ?? 0,
            activity_id: at?.id ?? '',
            activity_name: at?.name ?? '',
            activity_description: at?.description ?? '',
            activity_duration: at?.duration_minutes ?? 0,
            activity_credit_cost: at?.credit_cost ?? 1,
            activity_color: at?.color ?? '#C17A56',
            trainer_id: tr?.id ?? '',
            trainer_name: tr?.full_name ?? '',
          };
        });

      return { rows: userBookings, rowCount: userBookings.length };
    }

    // Consulta de asistentes a una sesión (GET /api/v1/sessions/:id/attendees)
    if (sql.includes('FROM bookings b') && sql.includes('JOIN users u') && sql.includes('session_id')) {
      const sessionId = String(params?.[0]);
      const sessionAttendees = bookings
        .filter((b) => b.session_id === sessionId && b.status === 'confirmed')
        .map((b) => {
          const u = users.find((user) => user.id === b.user_id);
          return {
            booking_id: b.id,
            user_id: b.user_id,
            full_name: u?.full_name ?? '',
            email: u?.email ?? '',
            created_at: b.created_at,
          };
        });
      return { rows: sessionAttendees, rowCount: sessionAttendees.length };
    }

    // 15. Bloqueo de reserva para cancelación (SELECT ... FROM bookings WHERE id = $1 FOR UPDATE)
    if (sql.includes('FROM bookings') && sql.includes('FOR UPDATE') && sql.includes('WHERE id = $1')) {
      await bookingLock.acquire();
      const bookingId = String(params?.[0]);
      const b = bookings.find((item) => item.id === bookingId);
      return {
        rows: b
          ? [
              {
                id: b.id,
                user_id: b.user_id,
                session_id: b.session_id,
                status: b.status,
                credits_charged: b.credits_charged,
                created_at: b.created_at,
                cancelled_at: b.cancelled_at,
              },
            ]
          : [],
        rowCount: b ? 1 : 0,
      };
    }

    // 16. Bloqueo de sesión para liberar plaza
    if (sql.includes('FROM sessions') && sql.includes('FOR UPDATE') && !sql.includes('FOR UPDATE OF s')) {
      await sessionLock.acquire();
      const sessionId = String(params?.[0]);
      const s = sessions.find((item) => item.id === sessionId);
      return {
        rows: s
          ? [
              {
                id: s.id,
                available_slots: s.available_slots,
                max_capacity: s.max_capacity,
              },
            ]
          : [],
        rowCount: s ? 1 : 0,
      };
    }

    // 17. Cancelar reserva (UPDATE bookings SET status = 'cancelled')
    if (sql.includes('UPDATE bookings') && sql.includes("status = 'cancelled'")) {
      const bookingId = String(params?.[0]);
      const b = bookings.find((item) => item.id === bookingId);
      const cancelledAt = new Date().toISOString();
      if (b) {
        b.status = 'cancelled';
        b.cancelled_at = cancelledAt;
      }
      return {
        rows: [{ cancelled_at: cancelledAt }],
        rowCount: b ? 1 : 0,
      };
    }

    // 18. Reembolsar créditos al usuario (UPDATE users SET credits = credits + $1)
    if (sql.includes('UPDATE users') && sql.includes('credits = credits + $1')) {
      const refund = Number(params?.[0]);
      const userId = String(params?.[1]);
      const u = users.find((item) => item.id === userId);
      if (u) {
        u.credits += refund;
      }
      return {
        rows: [{ credits: u?.credits ?? 0 }],
        rowCount: u ? 1 : 0,
      };
    }

    // 19. Incrementar plaza liberada en sessions
    if (sql.includes('UPDATE sessions') && sql.includes('available_slots = available_slots + 1')) {
      const sessionId = String(params?.[0]);
      const s = sessions.find((item) => item.id === sessionId);
      if (s) {
        s.available_slots = Math.min(s.max_capacity, s.available_slots + 1);
      }
      return { rows: [], rowCount: s ? 1 : 0 };
    }

    // 20. SELECT ... FOR UPDATE sobre artworks
    if (sql.includes('FROM artworks') && sql.includes('FOR UPDATE')) {
      await artworkLock.acquire();
      const artworkId = String(params?.[0]);
      const art = artworks.find((a) => a.id === artworkId);
      if (!art) return { rows: [], rowCount: 0 };
      return {
        rows: [
          {
            id: art.id,
            title: art.title,
            category: art.category,
            price_eur: art.price_eur,
            stock: art.stock,
            glaze_finish: art.glaze_finish,
            palette_hex: art.palette_hex,
          },
        ],
        rowCount: 1,
      };
    }

    // 21. UPDATE artworks SET stock = stock - 1
    if (sql.includes('UPDATE artworks') && sql.includes('stock = stock - 1')) {
      const artworkId = String(params?.[0]);
      const art = artworks.find((a) => a.id === artworkId);
      if (art) {
        if (art.stock <= 0) {
          const err = new Error('stock negative') as Error & { code: string; constraint: string };
          err.code = '23514';
          err.constraint = 'artworks_stock_non_negative';
          throw err;
        }
        art.stock -= 1;
        art.updated_at = new Date().toISOString();
        return { rows: [{ stock: art.stock }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // 22. SELECT catálogo de artworks (GET /api/v1/artworks)
    if (sql.includes('FROM artworks') && !sql.includes('FOR UPDATE') && !sql.includes('INSERT') && !sql.includes('UPDATE')) {
      const activeArtworks = artworks.filter((a) => a.is_active);
      return {
        rows: activeArtworks.map((a) => ({
          id: a.id,
          title: a.title,
          category: a.category,
          price_eur: a.price_eur,
          stock: a.stock,
          glaze_finish: a.glaze_finish,
          palette_hex: a.palette_hex,
          image_url: a.image_url,
          is_active: a.is_active,
          created_at: a.created_at,
          updated_at: a.updated_at,
        })),
        rowCount: activeArtworks.length,
      };
    }

    // 23. INSERT INTO artworks
    if (sql.includes('INSERT INTO artworks')) {
      const title = String(params?.[0]);
      const category = String(params?.[1]);
      const price_eur = Number(params?.[2]);
      const stock = Number(params?.[3]);
      const glaze_finish = String(params?.[4]);
      const palette_hex = String(params?.[5]);
      const image_url = params?.[6] ? String(params[6]) : null;
      const id = randomUUID();
      const nowStr = new Date().toISOString();
      const newArt: DbArtworkRecord = {
        id,
        title,
        category,
        price_eur,
        stock,
        glaze_finish,
        palette_hex,
        image_url,
        is_active: true,
        created_at: nowStr,
        updated_at: nowStr,
      };
      artworks.push(newArt);
      return {
        rows: [
          {
            id: newArt.id,
            title: newArt.title,
            category: newArt.category,
            price_eur: newArt.price_eur,
            stock: newArt.stock,
            glaze_finish: newArt.glaze_finish,
            palette_hex: newArt.palette_hex,
            image_url: newArt.image_url,
          },
        ],
        rowCount: 1,
      };
    }

    // 24. UPDATE artworks SET is_active = false / DELETE (DELETE /api/v1/artworks/:id)
    if ((sql.includes('UPDATE artworks') && sql.includes('is_active = false')) || sql.includes('DELETE FROM artworks')) {
      const artworkId = String(params?.[0]);
      const art = artworks.find((a) => a.id === artworkId);
      if (art) {
        art.is_active = false;
        art.updated_at = new Date().toISOString();
        return { rows: [{ id: art.id }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    return { rows: [], rowCount: 0 };
  };

  const createClient = () => {
    let holdsSessionLock = false;
    let holdsArtworkLock = false;
    let holdsUserLock = false;
    let holdsBookingLock = false;

    const releaseLocks = () => {
      if (holdsSessionLock) {
        holdsSessionLock = false;
        sessionLock.release();
      }
      if (holdsArtworkLock) {
        holdsArtworkLock = false;
        artworkLock.release();
      }
      if (holdsUserLock) {
        holdsUserLock = false;
        userLock.release();
      }
      if (holdsBookingLock) {
        holdsBookingLock = false;
        bookingLock.release();
      }
    };

    return {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.startsWith('BEGIN')) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FOR UPDATE OF s') || (sql.includes('FROM sessions') && sql.includes('FOR UPDATE'))) {
          holdsSessionLock = true;
        }
        if (sql.includes('FROM artworks') && sql.includes('FOR UPDATE')) {
          holdsArtworkLock = true;
        }
        if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) {
          holdsUserLock = true;
        }
        if (sql.includes('FROM bookings') && sql.includes('FOR UPDATE')) {
          holdsBookingLock = true;
        }
        if (sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) {
          releaseLocks();
          return { rows: [], rowCount: 0 };
        }
        return executeQuery(sql, params);
      },
      release: () => {
        releaseLocks();
      },
    };
  };

  const mockPool = {
    query: executeQuery,
    connect: async () => createClient(),
    end: async () => {},
  };

  return mockPool as unknown as pg.Pool;
}

/**
 * Inicializa el pool de base de datos de forma resiliente:
 * Si PostgreSQL está activo en DATABASE_URL, utiliza la conexión nativa real.
 * Si PostgreSQL no está corriendo (ej. Docker no instalado o detenido en dev),
 * activa la base de datos en memoria cargada con el seed de specs/schema.sql.
 */
export async function initializeDatabasePool(connectionString?: string): Promise<{
  pool: pg.Pool;
  isInMemory: boolean;
}> {
  const url = connectionString ?? process.env['DATABASE_URL'];

  if (url) {
    const realPool = new Pool({
      connectionString: url,
      connectionTimeoutMillis: 1500,
    });

    try {
      const client = await realPool.connect();
      await client.query('SELECT 1;');
      client.release();
      return { pool: realPool, isInMemory: false };
    } catch {
      await realPool.end().catch(() => {});
    }
  }

  // Fallback transparente a base de datos en memoria para desarrollo local
  const memoryPool = createInMemoryPool();
  return { pool: memoryPool, isInMemory: true };
}

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function withTransaction<T>(
  pool: pg.Pool,
  callback: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

