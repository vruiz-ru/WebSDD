import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/server.js';
import { createInMemoryPool } from '../src/db.js';
import type pg from 'pg';

/**
 * Simulación de Mutex para representar el bloqueo de fila pesimista (SELECT ... FOR UPDATE)
 * que ejecuta PostgreSQL 16 a nivel de motor.
 */
class RowMutex {
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

describe('Pruebas de Concurrencia y Negocio · Timp Cerámica', () => {
  it('GET /api/v1/sessions - Devuelve sesiones con JOIN de actividad y entrenadora', async () => {
    const mockSessions = [
      {
        session_id: 'e0000000-0000-0000-0000-000000000001',
        starts_at: '2026-11-14T10:00:00Z',
        ends_at: '2026-11-14T12:00:00Z',
        max_capacity: 6,
        available_slots: 1,
        activity_id: 'd0000000-0000-0000-0000-000000000001',
        activity_name: 'Torno Alfarero',
        activity_description: 'Iniciación y perfeccionamiento en el torno cerámico.',
        activity_duration: 120,
        activity_credit_cost: 1,
        activity_color: '#C17A56',
        trainer_id: 'b0000000-0000-0000-0000-000000000001',
        trainer_name: 'Carmen Martínez (Maestra Ceramista)',
      },
    ];

    const mockPool: unknown = {
      query: async (sql: string) => {
        if (sql.includes('FROM sessions s')) {
          return { rows: mockSessions };
        }
        return { rows: [] };
      },
      connect: async () => ({
        query: async () => ({ rows: [] }),
        release: () => {},
      }),
      end: async () => {},
    };

    const app = await buildServer({ pool: mockPool as pg.Pool, logger: false });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions?from=2026-11-14T00:00:00Z&to=2026-11-14T23:59:59Z',
    });

    assert.equal(res.statusCode, 200);
    const json = res.json();
    assert.equal(json.length, 1);
    assert.equal(json[0].activityType.name, 'Torno Alfarero');
    assert.equal(json[0].activityType.creditCost, 1);
    assert.equal(json[0].availableSlots, 1);
    assert.equal(json[0].trainer.fullName, 'Carmen Martínez (Maestra Ceramista)');

    await app.close();
  });

  it('POST /api/v1/bookings - Concurrencia estricta (Regla 3): dos usuarios intentan reservar la última plaza simultáneamente', async () => {
    const sessionMutex = new RowMutex();

    // Estado inicial en la base de datos simulada
    const sessionId = 'e0000000-0000-0000-0000-000000000001';
    let availableSlots = 1; // Solo 1 plaza libre de 6 en Torno Alfarero
    const creditCost = 1;

    const user1Id = 'c0000000-0000-0000-0000-000000000001';
    const user2Id = 'c0000000-0000-0000-0000-000000000002';

    const usersState: Record<string, { credits: number; is_active: boolean }> = {
      [user1Id]: { credits: 4, is_active: true },
      [user2Id]: { credits: 4, is_active: true },
    };

    const bookingsState: { id: string; userId: string; sessionId: string }[] = [];

    // Factory de cliente transaccional que simula el aislamiento y bloqueos de PostgreSQL 16
    const createMockClient = () => {
      let holdsSessionLock = false;

      return {
        query: async (sql: string, params?: unknown[]) => {
          // BEGIN TRANSACTION
          if (sql.startsWith('BEGIN')) {
            return { rows: [] };
          }

          // SELECT ... FOR UPDATE OF s (Bloqueo pesimista de fila)
          if (sql.includes('FOR UPDATE OF s')) {
            await sessionMutex.acquire();
            holdsSessionLock = true;
            return {
              rows: [
                {
                  id: sessionId,
                  max_capacity: 6,
                  available_slots: availableSlots,
                  credit_cost: creditCost,
                },
              ],
            };
          }

          // SELECT ... FROM users WHERE id = $1 FOR UPDATE
          if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) {
            const uid = String(params?.[0]);
            const u = usersState[uid];
            return {
              rows: u ? [{ id: uid, credits: u.credits, is_active: u.is_active }] : [],
            };
          }

          // Comprobación anti-doble reserva activa
          if (sql.includes('FROM bookings') && sql.includes("status = 'confirmed'")) {
            const uid = String(params?.[0]);
            const sid = String(params?.[1]);
            const existing = bookingsState.filter((b) => b.userId === uid && b.sessionId === sid);
            return { rows: existing };
          }

          // UPDATE sessions SET available_slots = available_slots - 1
          if (sql.includes('UPDATE sessions')) {
            availableSlots -= 1;
            return { rows: [] };
          }

          // UPDATE users SET credits = credits - $1
          if (sql.includes('UPDATE users')) {
            const amount = Number(params?.[0]);
            const uid = String(params?.[1]);
            const u = usersState[uid];
            if (u) u.credits -= amount;
            return { rows: [] };
          }

          // INSERT INTO bookings
          if (sql.includes('INSERT INTO bookings')) {
            const uid = String(params?.[0]);
            const sid = String(params?.[1]);
            const newId = `bkg-${bookingsState.length + 1}`;
            bookingsState.push({ id: newId, userId: uid, sessionId: sid });
            return {
              rows: [{ id: newId, created_at: new Date().toISOString() }],
            };
          }

          // COMMIT TRANSACTION
          if (sql.startsWith('COMMIT')) {
            if (holdsSessionLock) {
              holdsSessionLock = false;
              sessionMutex.release();
            }
            return { rows: [] };
          }

          // ROLLBACK TRANSACTION
          if (sql.startsWith('ROLLBACK')) {
            if (holdsSessionLock) {
              holdsSessionLock = false;
              sessionMutex.release();
            }
            return { rows: [] };
          }

          return { rows: [] };
        },
        release: () => {
          if (holdsSessionLock) {
            holdsSessionLock = false;
            sessionMutex.release();
          }
        },
      };
    };

    const mockPool: unknown = {
      connect: async () => createMockClient(),
      query: async () => ({ rows: [] }),
      end: async () => {},
    };

    const app = await buildServer({ pool: mockPool as pg.Pool, logger: false });

    // Generar tokens JWT legítimos para ambos usuarios
    const tokenUser1 = app.jwt.sign({ sub: user1Id, role: 'client' });
    const tokenUser2 = app.jwt.sign({ sub: user2Id, role: 'client' });

    // LANZAMIENTO SIMULTÁNEO DE AMBAS PETICIONES DE RESERVA
    const [resUser1, resUser2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/v1/bookings',
        cookies: { access_token: tokenUser1 },
        payload: { sessionId },
      }),
      app.inject({
        method: 'POST',
        url: '/api/v1/bookings',
        cookies: { access_token: tokenUser2 },
        payload: { sessionId },
      }),
    ]);

    const statusCodes = [resUser1.statusCode, resUser2.statusCode].sort();

    // Verificación crítica: EXACTAMENTE UNO RECIBE 201 Y EL OTRO 409
    assert.deepEqual(
      statusCodes,
      [201, 409],
      `Se esperaba [201, 409] pero se obtuvo [${resUser1.statusCode}, ${resUser2.statusCode}]`
    );

    // Identificar cuál fue la reserva exitosa y cuál fue rechazada
    const successRes = resUser1.statusCode === 201 ? resUser1 : resUser2;
    const conflictRes = resUser1.statusCode === 409 ? resUser1 : resUser2;

    const successJson = successRes.json();
    assert.equal(successJson.status, 'confirmed');
    assert.equal(successJson.sessionId, sessionId);
    assert.equal(successJson.creditsCharged, 1);
    assert.equal(successJson.remainingCredits, 3);

    const conflictJson = conflictRes.json();
    assert.equal(conflictJson.error.code, 'SLOTS_EXHAUSTED');
    assert.equal(conflictJson.error.message, 'La sesión seleccionada no tiene plazas disponibles.');

    // Verificación del estado final de la base de datos
    assert.equal(availableSlots, 0, 'La clase de Torno Alfarero debe tener 0 plazas libres');
    assert.equal(bookingsState.length, 1, 'Debe haberse creado exactamente 1 reserva');

    await app.close();
  });

  it('GET /api/v1/bookings/me - Listado tipado de reservas del usuario autenticado', async () => {
    const userId = 'c0000000-0000-0000-0000-000000000001';

    const mockBookings = [
      {
        booking_id: 'a0000000-0000-0000-0000-000000000001',
        session_id: 'e0000000-0000-0000-0000-000000000001',
        booking_status: 'confirmed',
        credits_charged: 1,
        booking_created_at: '2026-11-13T10:00:00.000Z',
        booking_cancelled_at: null,
        starts_at: '2026-11-14T10:00:00.000Z',
        ends_at: '2026-11-14T12:00:00.000Z',
        max_capacity: 6,
        available_slots: 0,
        activity_id: 'd0000000-0000-0000-0000-000000000001',
        activity_name: 'Torno Alfarero',
        activity_description: 'Iniciación en el torno cerámico.',
        activity_duration: 120,
        activity_credit_cost: 1,
        activity_color: '#C17A56',
        trainer_id: 'b0000000-0000-0000-0000-000000000001',
        trainer_name: 'Carmen Martínez (Maestra Ceramista)',
      },
    ];

    const mockPool: unknown = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM bookings b') && params?.[0] === userId) {
          return { rows: mockBookings };
        }
        return { rows: [] };
      },
      connect: async () => ({
        query: async () => ({ rows: [] }),
        release: () => {},
      }),
      end: async () => {},
    };

    const app = await buildServer({ pool: mockPool as pg.Pool, logger: false });

    // 1. Petición sin autenticación -> 401
    const unauthRes = await app.inject({
      method: 'GET',
      url: '/api/v1/bookings/me',
    });
    assert.equal(unauthRes.statusCode, 401);
    assert.equal(unauthRes.json().error.code, 'UNAUTHORIZED');

    // 2. Petición autenticada -> 200 con la lista de reservas
    const token = app.jwt.sign({ sub: userId, role: 'client' });
    const authRes = await app.inject({
      method: 'GET',
      url: '/api/v1/bookings/me',
      cookies: { access_token: token },
    });

    assert.equal(authRes.statusCode, 200);
    const bookings = authRes.json();
    assert.equal(bookings.length, 1);
    assert.equal(bookings[0].id, 'a0000000-0000-0000-0000-000000000001');
    assert.equal(bookings[0].status, 'confirmed');
    assert.equal(bookings[0].creditsCharged, 1);
    assert.equal(bookings[0].session.activityType.name, 'Torno Alfarero');
    assert.equal(bookings[0].session.trainer.fullName, 'Carmen Martínez (Maestra Ceramista)');

    await app.close();
  });

  it('DELETE /api/v1/bookings/:id - Transacción SQL atómica (Regla 3), reembolso de créditos y liberación de plaza', async () => {
    const user1Id = 'c0000000-0000-0000-0000-000000000001';
    const user2Id = 'c0000000-0000-0000-0000-000000000002';
    const sessionId = 'e0000000-0000-0000-0000-000000000001';
    const booking1Id = 'a0000000-0000-0000-0000-000000000001';

    interface BookingRecord {
      id: string;
      user_id: string;
      session_id: string;
      status: 'confirmed' | 'cancelled';
      credits_charged: number;
      created_at: string;
      cancelled_at: string | null;
    }

    const bookingsState: Record<string, BookingRecord> = {
      [booking1Id]: {
        id: booking1Id,
        user_id: user1Id,
        session_id: sessionId,
        status: 'confirmed',
        credits_charged: 2,
        created_at: '2026-11-13T10:00:00.000Z',
        cancelled_at: null,
      },
    };

    const usersState: Record<string, { credits: number; is_active: boolean }> = {
      [user1Id]: { credits: 2, is_active: true },
      [user2Id]: { credits: 5, is_active: true },
    };

    let sessionAvailableSlots = 3;

    const createMockClient = () => {
      let inTransaction = false;

      return {
        query: async (sql: string, params?: unknown[]) => {
          if (sql.startsWith('BEGIN')) {
            inTransaction = true;
            return { rows: [] };
          }

          // Bloqueo de fila de la reserva
          if (sql.includes('FROM bookings') && sql.includes('FOR UPDATE')) {
            const bId = String(params?.[0]);
            const b = bookingsState[bId];
            return { rows: b ? [{ ...b }] : [] };
          }

          // Bloqueo de fila del usuario
          if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) {
            const uId = String(params?.[0]);
            const u = usersState[uId];
            return { rows: u ? [{ id: uId, credits: u.credits }] : [] };
          }

          // Bloqueo de fila de sesión
          if (sql.includes('FROM sessions') && sql.includes('FOR UPDATE')) {
            return {
              rows: [{ id: sessionId, available_slots: sessionAvailableSlots, max_capacity: 6 }],
            };
          }

          // Actualizar estado de reserva
          if (sql.includes('UPDATE bookings') && sql.includes("status = 'cancelled'")) {
            const bId = String(params?.[0]);
            const b = bookingsState[bId];
            const now = new Date().toISOString();
            if (b) {
              b.status = 'cancelled';
              b.cancelled_at = now;
            }
            return { rows: [{ cancelled_at: now }] };
          }

          // Reembolsar créditos
          if (sql.includes('UPDATE users') && sql.includes('credits = credits + $1')) {
            const refund = Number(params?.[0]);
            const uId = String(params?.[1]);
            const u = usersState[uId];
            if (u) {
              u.credits += refund;
            }
            return { rows: [{ credits: u?.credits ?? 0 }] };
          }

          // Incrementar plazas en sesión
          if (sql.includes('UPDATE sessions') && sql.includes('available_slots = available_slots + 1')) {
            sessionAvailableSlots += 1;
            return { rows: [] };
          }

          if (sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) {
            inTransaction = false;
            return { rows: [] };
          }

          return { rows: [] };
        },
        release: () => {
          inTransaction = false;
        },
      };
    };

    const mockPool: unknown = {
      connect: async () => createMockClient(),
      query: async () => ({ rows: [] }),
      end: async () => {},
    };

    const app = await buildServer({ pool: mockPool as pg.Pool, logger: false });
    const tokenUser1 = app.jwt.sign({ sub: user1Id, role: 'client' });
    const tokenUser2 = app.jwt.sign({ sub: user2Id, role: 'client' });

    // 1. Petición no autenticada -> 401
    const unauthRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/bookings/${booking1Id}`,
    });
    assert.equal(unauthRes.statusCode, 401);

    // 2. ID no UUID válido -> 400
    const invalidIdRes = await app.inject({
      method: 'DELETE',
      url: '/api/v1/bookings/not-a-valid-uuid',
      cookies: { access_token: tokenUser1 },
    });
    assert.equal(invalidIdRes.statusCode, 400);
    assert.equal(invalidIdRes.json().error.code, 'INVALID_BOOKING_ID');

    // 3. Reserva inexistente -> 404
    const notFoundRes = await app.inject({
      method: 'DELETE',
      url: '/api/v1/bookings/00000000-0000-0000-0000-000000000404',
      cookies: { access_token: tokenUser1 },
    });
    assert.equal(notFoundRes.statusCode, 404);
    assert.equal(notFoundRes.json().error.code, 'BOOKING_NOT_FOUND');

    // 4. Intentar cancelar reserva de otro usuario -> 403 Forbidden (RBAC en servidor)
    const forbiddenRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/bookings/${booking1Id}`,
      cookies: { access_token: tokenUser2 },
    });
    assert.equal(forbiddenRes.statusCode, 403);
    assert.equal(forbiddenRes.json().error.code, 'FORBIDDEN');
    // El saldo de user1 sigue siendo 2 y la reserva confirmed
    assert.equal(usersState[user1Id].credits, 2);
    assert.equal(bookingsState[booking1Id].status, 'confirmed');

    // 5. Cancelación exitosa por el propietario de la reserva -> 200 OK
    const cancelRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/bookings/${booking1Id}`,
      cookies: { access_token: tokenUser1 },
    });
    assert.equal(cancelRes.statusCode, 200);
    const cancelBody = cancelRes.json();
    assert.equal(cancelBody.bookingId, booking1Id);
    assert.equal(cancelBody.creditsRefunded, 2);
    assert.equal(cancelBody.newCreditBalance, 4); // 2 previos + 2 reembolsados = 4
    assert.ok(cancelBody.cancelledAt);

    // Verificación de estado en BD
    assert.equal(bookingsState[booking1Id].status, 'cancelled');
    assert.ok(bookingsState[booking1Id].cancelled_at);
    assert.equal(usersState[user1Id].credits, 4, 'Saldo de créditos debe haberse incrementado');
    assert.equal(sessionAvailableSlots, 4, 'La plaza liberada debe haber incrementado available_slots');

    // 6. Intento de doble cancelación -> 400 BOOKING_ALREADY_CANCELLED
    const doubleCancelRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/bookings/${booking1Id}`,
      cookies: { access_token: tokenUser1 },
    });
    assert.equal(doubleCancelRes.statusCode, 400);
    assert.equal(doubleCancelRes.json().error.code, 'BOOKING_ALREADY_CANCELLED');

    await app.close();
  });

  it('RBAC y Studio - Client recibe 403 al crear sesiones o recargar créditos, y Admin recibe 201/200', async () => {
    const pool = createInMemoryPool();
    const app = await buildServer({ pool, logger: false });

    const adminId = 'a0000000-0000-0000-0000-000000000001';
    const clientId = 'c0000000-0000-0000-0000-000000000001';
    const activityId = 'd0000000-0000-0000-0000-000000000001';

    const tokenAdmin = app.jwt.sign({ sub: adminId, role: 'admin' });
    const tokenClient = app.jwt.sign({ sub: clientId, role: 'client' });

    const newSessionPayload = {
      activityTypeId: activityId,
      startsAt: '2026-11-20T10:00:00Z',
      endsAt: '2026-11-20T12:00:00Z',
      maxCapacity: 6,
    };

    // 1. Client intenta crear sesión -> 403 FORBIDDEN
    const clientSessionRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      cookies: { access_token: tokenClient },
      payload: newSessionPayload,
    });
    assert.equal(clientSessionRes.statusCode, 403);
    assert.equal(clientSessionRes.json().error.code, 'FORBIDDEN');

    // 2. Client intenta recargar créditos -> 403 FORBIDDEN
    const clientCreditsRes = await app.inject({
      method: 'POST',
      url: `/api/v1/users/${clientId}/credits`,
      cookies: { access_token: tokenClient },
      payload: { delta: 4 },
    });
    assert.equal(clientCreditsRes.statusCode, 403);
    assert.equal(clientCreditsRes.json().error.code, 'FORBIDDEN');

    // 3. Admin crea sesión -> 201 Created
    const adminSessionRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      cookies: { access_token: tokenAdmin },
      payload: newSessionPayload,
    });
    assert.equal(adminSessionRes.statusCode, 201);
    const sessionJson = adminSessionRes.json();
    assert.equal(sessionJson.maxCapacity, 6);
    assert.equal(sessionJson.availableSlots, 6);
    assert.equal(sessionJson.activityType.id, activityId);

    // 4. Admin recarga créditos -> 200 OK
    const adminCreditsRes = await app.inject({
      method: 'POST',
      url: `/api/v1/users/${clientId}/credits`,
      cookies: { access_token: tokenAdmin },
      payload: { delta: 4 },
    });
    assert.equal(adminCreditsRes.statusCode, 200);
    const creditsJson = adminCreditsRes.json();
    assert.equal(creditsJson.id, clientId);
    assert.equal(creditsJson.credits, 8); // 4 iniciales + 4 sumados = 8

    await app.close();
  });

  it('RBAC y Asistencia - Client recibe 403 en attendees y Trainer/Admin reciben 200', async () => {
    const pool = createInMemoryPool();
    const app = await buildServer({ pool, logger: false });

    const adminId = 'a0000000-0000-0000-0000-000000000001';
    const trainerId = 'b0000000-0000-0000-0000-000000000001';
    const clientId = 'c0000000-0000-0000-0000-000000000001';
    const sessionId = 'e0000000-0000-0000-0000-000000000001';

    const tokenAdmin = app.jwt.sign({ sub: adminId, role: 'admin' });
    const tokenTrainer = app.jwt.sign({ sub: trainerId, role: 'trainer' });
    const tokenClient = app.jwt.sign({ sub: clientId, role: 'client' });

    // 1. Client intenta consultar attendees -> 403 FORBIDDEN
    const clientAttendeesRes = await app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}/attendees`,
      cookies: { access_token: tokenClient },
    });
    assert.equal(clientAttendeesRes.statusCode, 403);
    assert.equal(clientAttendeesRes.json().error.code, 'FORBIDDEN');

    // 2. Trainer consulta attendees -> 200 OK
    const trainerAttendeesRes = await app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}/attendees`,
      cookies: { access_token: tokenTrainer },
    });
    assert.equal(trainerAttendeesRes.statusCode, 200);
    const trainerJson = trainerAttendeesRes.json();
    assert.ok(Array.isArray(trainerJson));
    assert.equal(trainerJson.length, 1);
    assert.equal(trainerJson[0].userId, clientId);
    assert.equal(trainerJson[0].fullName, 'Sofía Valero');

    // 3. Admin consulta attendees -> 200 OK
    const adminAttendeesRes = await app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}/attendees`,
      cookies: { access_token: tokenAdmin },
    });
    assert.equal(adminAttendeesRes.statusCode, 200);
    const adminJson = adminAttendeesRes.json();
    assert.ok(Array.isArray(adminJson));
    assert.equal(adminJson.length, 1);
    assert.equal(adminJson[0].userId, clientId);

    await app.close();
  });

  it('DELETE /api/v1/bookings/:id - Cancela con Content-Type: application/json vacío y fechas ISO en sesiones nuevas', async () => {
    const pool = createInMemoryPool();
    const app = await buildServer({ pool, logger: false });

    const adminId = 'a0000000-0000-0000-0000-000000000001';
    const clientId = 'c0000000-0000-0000-0000-000000000001';
    const tokenClient = app.jwt.sign({ sub: clientId, role: 'client' });
    const tokenAdmin = app.jwt.sign({ sub: adminId, role: 'admin' });

    // 1. Cancelar la reserva inicial del seed enviando Content-Type: application/json sin body
    const seedBookingId = 'f0000000-0000-0000-0000-000000000001';
    const cancelSeedRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/bookings/${seedBookingId}`,
      headers: { 'content-type': 'application/json' },
      cookies: { access_token: tokenClient },
    });
    assert.equal(cancelSeedRes.statusCode, 200);
    assert.equal(cancelSeedRes.json().bookingId, seedBookingId);

    // 2. Crear una nueva sesión futura y comprobar que GET /api/v1/sessions la encuentra con rango ISO
    const futureStart = '2026-12-01T10:00:00.000Z';
    const futureEnd = '2026-12-01T12:00:00.000Z';
    const createSessionRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      cookies: { access_token: tokenAdmin },
      payload: {
        activityTypeId: 'd0000000-0000-0000-0000-000000000001',
        startsAt: futureStart,
        endsAt: futureEnd,
        maxCapacity: 6,
      },
    });
    assert.equal(createSessionRes.statusCode, 201);
    const newSessionId = createSessionRes.json().id;

    const getSessionsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions?from=2026-12-01T00:00:00.000Z&to=2026-12-01T23:59:59.000Z',
    });
    assert.equal(getSessionsRes.statusCode, 200);
    const foundSession = getSessionsRes.json().find((s: { id: string }) => s.id === newSessionId);
    assert.ok(foundSession);

    // 3. Crear una nueva reserva para la nueva sesión y luego cancelarla con Content-Type: application/json vacío
    const createBookingRes = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      cookies: { access_token: tokenClient },
      payload: { sessionId: newSessionId },
    });
    assert.equal(createBookingRes.statusCode, 201);
    const newBookingId = createBookingRes.json().id;

    const cancelNewRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/bookings/${newBookingId}`,
      headers: { 'content-type': 'application/json' },
      cookies: { access_token: tokenClient },
    });
    assert.equal(cancelNewRes.statusCode, 200);
    assert.equal(cancelNewRes.json().bookingId, newBookingId);

    await app.close();
  });

  it("POST /api/v1/artworks/:id/buy - Concurrencia estricta (Regla 3): dos compradores intentan comprar simultáneamente la 'Trío Jarras Asa Circular · Serie Klein' (stock: 1)", async () => {
    const pool = createInMemoryPool();
    const app = await buildServer({ pool, logger: false });

    const artworkId = 'f1000000-0000-0000-0000-000000000004'; // Trío Jarras Asa Circular · Serie Klein (stock: 1)

    // 1. Comprobación inicial del catálogo: 6 obras curadas, stock = 1 y fotos reales
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/artworks',
    });
    assert.equal(getRes.statusCode, 200);
    const artworks = getRes.json();
    assert.equal(artworks.length, 6);
    const jarra = artworks.find((a: { id: string }) => a.id === artworkId);
    assert.ok(jarra);
    assert.equal(jarra.stock, 1);
    assert.equal(jarra.title, 'Trío Jarras Asa Circular · Serie Klein');
    assert.equal(jarra.imageUrl, '/media/obras/jarras-klein.jpg');

    // 2. LANZAMIENTO SIMULTÁNEO DE AMBAS COMPRAS
    const [res1, res2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/v1/artworks/${artworkId}/buy`,
        payload: {
          buyerName: 'Comprador 1 (Ana)',
          buyerEmail: 'ana@example.com',
        },
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/artworks/${artworkId}/buy`,
        payload: {
          buyerName: 'Comprador 2 (David)',
          buyerEmail: 'david@example.com',
        },
      }),
    ]);

    const statusCodes = [res1.statusCode, res2.statusCode].sort();

    // Verificación crítica: Uno recibe 200 OK y el otro 409 CONFLICT
    assert.deepEqual(
      statusCodes,
      [200, 409],
      `Se esperaba [200, 409] pero se obtuvo [${res1.statusCode}, ${res2.statusCode}]`
    );

    const successRes = res1.statusCode === 200 ? res1 : res2;
    const conflictRes = res1.statusCode === 409 ? res1 : res2;

    const successJson = successRes.json();
    assert.equal(successJson.remainingStock, 0);
    assert.equal(successJson.artworkId, artworkId);
    assert.equal(successJson.title, 'Trío Jarras Asa Circular · Serie Klein');
    assert.ok(successJson.orderRef);

    const conflictJson = conflictRes.json();
    assert.equal(conflictJson.error.code, 'STOCK_EXHAUSTED');

    // 3. Intento de compra con stock agotado -> 409 CONFLICT
    const res3 = await app.inject({
      method: 'POST',
      url: `/api/v1/artworks/${artworkId}/buy`,
      payload: {
        buyerName: 'Comprador 3 (Carlos)',
        buyerEmail: 'carlos@example.com',
      },
    });
    assert.equal(res3.statusCode, 409);
    assert.equal(res3.json().error.code, 'STOCK_EXHAUSTED');

    // 4. RBAC en POST /api/v1/artworks: Client recibe 403 y Admin recibe 201
    const adminId = 'a0000000-0000-0000-0000-000000000001';
    const clientId = 'c0000000-0000-0000-0000-000000000001';
    const tokenAdmin = app.jwt.sign({ sub: adminId, role: 'admin' });
    const tokenClient = app.jwt.sign({ sub: clientId, role: 'client' });

    const clientArtRes = await app.inject({
      method: 'POST',
      url: '/api/v1/artworks',
      cookies: { access_token: tokenClient },
      payload: {
        title: 'Pieza Nueva',
        category: 'Vasijas',
        priceEur: 60,
        stock: 2,
        glazeFinish: 'Gres texturizado',
        paletteHex: '#C47451',
        imageUrl: '/media/obras/pieza-nueva.jpg',
      },
    });
    assert.equal(clientArtRes.statusCode, 403);
    assert.equal(clientArtRes.json().error.code, 'FORBIDDEN');

    const adminArtRes = await app.inject({
      method: 'POST',
      url: '/api/v1/artworks',
      cookies: { access_token: tokenAdmin },
      payload: {
        title: 'Pieza Nueva Admin',
        category: 'Vasijas',
        priceEur: 60,
        stock: 2,
        glazeFinish: 'Gres texturizado',
        paletteHex: '#C47451',
        imageUrl: '/media/obras/pieza-nueva.jpg',
      },
    });
    assert.equal(adminArtRes.statusCode, 201);
    const createdArt = adminArtRes.json();
    assert.equal(createdArt.title, 'Pieza Nueva Admin');
    assert.equal(createdArt.imageUrl, '/media/obras/pieza-nueva.jpg');

    // 5. DELETE /api/v1/artworks/:id (Retirar pieza del catálogo)
    // Client recibe 403
    const clientDelRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/artworks/${createdArt.id}`,
      cookies: { access_token: tokenClient },
    });
    assert.equal(clientDelRes.statusCode, 403);

    // Admin retira la pieza -> 200 OK
    const adminDelRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/artworks/${createdArt.id}`,
      cookies: { access_token: tokenAdmin },
    });
    assert.equal(adminDelRes.statusCode, 200);
    assert.equal(adminDelRes.json().artworkId, createdArt.id);

    // Comprobar que ya no aparece en el catálogo
    const catalogAfterDel = await app.inject({ method: 'GET', url: '/api/v1/artworks' });
    const exists = catalogAfterDel.json().some((a: { id: string }) => a.id === createdArt.id);
    assert.equal(exists, false);

    await app.close();
  });

  it('E2E Completo: Login de profesora -> Crear Sesión con cookie -> Crear Obra con cookie -> Comprar Obra -> Retirar Obra -> Reservar y Cancelar Reserva -> Logout', async () => {
    const pool = createInMemoryPool();
    const app = await buildServer({ pool, logger: false });

    // 1. Login de profesora (Beatriz Tabliega) -> cookie access_token + refresh_token
    const trainerLoginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'carmen.profesora@tallerbarro.com',
        password: 'CeramicaSegura2026!',
      },
    });
    assert.equal(trainerLoginRes.statusCode, 200);
    assert.equal(trainerLoginRes.json().user.fullName, 'Beatriz Tabliega');
    assert.equal(trainerLoginRes.json().user.role, 'trainer');

    const trainerAccessCookie = trainerLoginRes.cookies.find((c) => c.name === 'access_token');
    const trainerRefreshCookie = trainerLoginRes.cookies.find((c) => c.name === 'refresh_token');
    assert.ok(trainerAccessCookie, 'Debe devolver cookie access_token');
    assert.ok(trainerRefreshCookie, 'Debe devolver cookie refresh_token');
    assert.equal(trainerAccessCookie.httpOnly, true);
    assert.ok(trainerLoginRes.headers['authorization']);

    const trainerCookieHeader = { access_token: trainerAccessCookie.value };

    // 2. Crear Sesión de torno con la cookie de la profesora
    const createSessionRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      cookies: trainerCookieHeader,
      payload: {
        activityTypeId: 'e0000000-0000-0000-0000-000000000001',
        startsAt: new Date(Date.now() + 86400000 * 5).toISOString(),
        endsAt: new Date(Date.now() + 86400000 * 5 + 7200000).toISOString(),
        maxCapacity: 4,
      },
    });
    assert.equal(createSessionRes.statusCode, 201);
    const sessionData = createSessionRes.json();
    assert.ok(sessionData.id);
    assert.equal(sessionData.trainer.fullName, 'Beatriz Tabliega');
    assert.equal(sessionData.availableSlots, 4);

    // 3. Crear Obra en tienda con cookie de la profesora
    const createArtRes = await app.inject({
      method: 'POST',
      url: '/api/v1/artworks',
      cookies: trainerCookieHeader,
      payload: {
        title: 'Jarrón Escultórico E2E · Cobalto',
        category: 'Escultura',
        priceEur: 145,
        stock: 1,
        glazeFinish: 'Gres chamotado y azul cobalto',
        paletteHex: '#1D3566',
        imageUrl: '/media/obras/jarron-e2e.jpg',
      },
    });
    assert.equal(createArtRes.statusCode, 201);
    const createdArt = createArtRes.json();
    assert.ok(createdArt.id);
    assert.equal(createdArt.title, 'Jarrón Escultórico E2E · Cobalto');
    assert.equal(createdArt.stock, 1);

    // 4. Comprar Obra (cliente público) -> stock pasa de 1 a 0
    const buyRes = await app.inject({
      method: 'POST',
      url: `/api/v1/artworks/${createdArt.id}/buy`,
      payload: {
        buyerName: 'Lucía Coleccionista',
        buyerEmail: 'lucia@coleccion.com',
      },
    });
    assert.equal(buyRes.statusCode, 200);
    assert.equal(buyRes.json().remainingStock, 0);
    assert.ok(buyRes.json().orderRef);

    // Intentar comprar de nuevo la misma obra -> 409 STOCK_EXHAUSTED
    const buyAgainRes = await app.inject({
      method: 'POST',
      url: `/api/v1/artworks/${createdArt.id}/buy`,
      payload: {
        buyerName: 'Carlos Segundo',
        buyerEmail: 'carlos@coleccion.com',
      },
    });
    assert.equal(buyAgainRes.statusCode, 409);
    assert.equal(buyAgainRes.json().error.code, 'STOCK_EXHAUSTED');

    // 5. Retirar Obra del catálogo con cookie de la profesora
    const retireArtRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/artworks/${createdArt.id}`,
      cookies: trainerCookieHeader,
    });
    assert.equal(retireArtRes.statusCode, 200);
    assert.equal(retireArtRes.json().artworkId, createdArt.id);

    // Verificar que la obra ya no está activa en el catálogo
    const catalogRes = await app.inject({ method: 'GET', url: '/api/v1/artworks' });
    const isPresent = catalogRes.json().some((a: { id: string }) => a.id === createdArt.id);
    assert.equal(isPresent, false);

    // 6. Alumna inicia sesión, reserva la sesión creada y luego cancela la reserva
    const clientLoginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'sofia.alumna@example.com',
        password: 'CeramicaSegura2026!',
      },
    });
    assert.equal(clientLoginRes.statusCode, 200);
    const initialCredits = clientLoginRes.json().user.credits;
    const clientAccessCookie = clientLoginRes.cookies.find((c) => c.name === 'access_token');
    assert.ok(clientAccessCookie);
    const clientCookieHeader = { access_token: clientAccessCookie.value };

    // Reserva la sesión
    const bookRes = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      cookies: clientCookieHeader,
      payload: {
        sessionId: sessionData.id,
      },
    });
    assert.equal(bookRes.statusCode, 201);
    const booking = bookRes.json();
    assert.ok(booking.id);
    assert.equal(booking.remainingCredits, initialCredits - 1);

    // Cancelar la reserva
    const cancelRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/bookings/${booking.id}`,
      cookies: clientCookieHeader,
    });
    assert.equal(cancelRes.statusCode, 200);
    assert.equal(cancelRes.json().bookingId, booking.id);
    assert.equal(cancelRes.json().creditsRefunded, 1);
    assert.equal(cancelRes.json().newCreditBalance, initialCredits);
    assert.ok(cancelRes.json().cancelledAt);

    // 7. Logout de la profesora y verificación de limpieza de cookies
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      cookies: { refresh_token: trainerRefreshCookie.value },
    });
    assert.equal(logoutRes.statusCode, 200);
    assert.equal(logoutRes.json().message, 'Sesión cerrada correctamente');

    await app.close();
  });
});
