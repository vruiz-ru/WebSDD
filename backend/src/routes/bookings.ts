import type { FastifyPluginAsync } from 'fastify';
import type { components } from '../types/api.js';
import { withTransaction, ApiError } from '../db.js';

type S = components['schemas'];
interface DbSessionLockRow { id: string; max_capacity: number; available_slots: number; credit_cost: number; }
interface DbUserLockRow { id: string; credits: number; is_active: boolean; }
interface DbBookingLockRow { id: string; user_id: string; session_id: string; status: 'confirmed' | 'cancelled'; credits_charged: number; }
interface DbMyBookingRow {
  booking_id: string; session_id: string; booking_status: 'confirmed' | 'cancelled'; credits_charged: number;
  booking_created_at: Date | string; booking_cancelled_at: Date | string | null; starts_at: Date | string;
  ends_at: Date | string; max_capacity: number; available_slots: number; activity_id: string; activity_name: string;
  activity_description: string | null; activity_duration: number; activity_credit_cost: number; activity_color: string;
  trainer_id: string; trainer_name: string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const bookingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Reply: S['UserBookingItem'][] | S['ErrorResponse'] }>('/bookings/me', { preHandler: fastify.authenticate }, async (request, reply) => {
    const result = await fastify.db.query<DbMyBookingRow>(
      `SELECT b.id AS booking_id, b.session_id, b.status AS booking_status, b.credits_charged,
              b.created_at AS booking_created_at, b.cancelled_at AS booking_cancelled_at,
              s.starts_at, s.ends_at, s.max_capacity, s.available_slots,
              at.id AS activity_id, at.name AS activity_name, at.description AS activity_description,
              at.duration_minutes AS activity_duration, at.credit_cost AS activity_credit_cost, at.color AS activity_color,
              u.id AS trainer_id, u.full_name AS trainer_name
       FROM bookings b
       JOIN sessions s ON s.id = b.session_id JOIN activity_types at ON at.id = s.activity_type_id JOIN users u ON u.id = s.trainer_id
       WHERE b.user_id = $1 ORDER BY b.created_at DESC;`,
      [request.user.sub]
    );

    return reply.status(200).send(result.rows.map((r) => ({
      id: r.booking_id, sessionId: r.session_id, status: r.booking_status, creditsCharged: Number(r.credits_charged),
      createdAt: new Date(r.booking_created_at).toISOString(),
      cancelledAt: r.booking_cancelled_at ? new Date(r.booking_cancelled_at).toISOString() : null,
      session: {
        id: r.session_id, startsAt: new Date(r.starts_at).toISOString(), endsAt: new Date(r.ends_at).toISOString(),
        maxCapacity: Number(r.max_capacity), availableSlots: Number(r.available_slots),
        activityType: {
          id: r.activity_id, name: r.activity_name, description: r.activity_description,
          durationMinutes: Number(r.activity_duration), creditCost: Number(r.activity_credit_cost), color: r.activity_color,
        },
        trainer: { id: r.trainer_id, fullName: r.trainer_name },
      },
    })));
  });

  fastify.post<{ Body: S['CreateBookingRequest']; Reply: S['BookingConfirmedResponse'] | S['ErrorResponse'] }>('/bookings', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { sessionId } = request.body ?? {};
    if (!sessionId || typeof sessionId !== 'string' || !UUID_REGEX.test(sessionId)) {
      return reply.status(400).send({ error: { code: 'INVALID_SESSION_ID', message: 'El sessionId proporcionado no es un UUID válido.' } });
    }

    const res = await withTransaction(fastify.db, async (client) => {
      const sRes = await client.query<DbSessionLockRow>(
        `SELECT s.id, s.max_capacity, s.available_slots, at.credit_cost FROM sessions s JOIN activity_types at ON at.id = s.activity_type_id WHERE s.id = $1 FOR UPDATE OF s;`,
        [sessionId]
      );
      const session = sRes.rows[0];
      if (!session) throw new ApiError(400, 'SESSION_NOT_FOUND', 'La sesión solicitada no existe.');
      if (session.available_slots <= 0) throw new ApiError(409, 'SLOTS_EXHAUSTED', 'La sesión seleccionada no tiene plazas disponibles.');

      const uRes = await client.query<DbUserLockRow>(`SELECT id, credits, is_active FROM users WHERE id = $1 FOR UPDATE;`, [request.user.sub]);
      const user = uRes.rows[0];
      if (!user || !user.is_active) throw new ApiError(401, 'USER_INACTIVE', 'Cuenta de usuario inactiva o no encontrada.');

      const dup = await client.query(`SELECT id FROM bookings WHERE user_id = $1 AND session_id = $2 AND status = 'confirmed';`, [request.user.sub, sessionId]);
      if (dup.rows.length > 0) throw new ApiError(409, 'DUPLICATE_BOOKING', 'Ya dispones de una reserva confirmada para esta sesión.');

      const cost = Number(session.credit_cost);
      if (user.credits < cost) throw new ApiError(403, 'INSUFFICIENT_CREDITS', `No dispones de créditos suficientes para reservar esta actividad (requeridos: ${cost}, disponibles: ${user.credits}).`);

      await client.query(`UPDATE sessions SET available_slots = available_slots - 1 WHERE id = $1;`, [sessionId]);
      await client.query(`UPDATE users SET credits = credits - $1 WHERE id = $2;`, [cost, request.user.sub]);
      const bRes = await client.query<{ id: string; created_at: Date | string }>(
        `INSERT INTO bookings (user_id, session_id, status, credits_charged) VALUES ($1, $2, 'confirmed', $3) RETURNING id, created_at;`,
        [request.user.sub, sessionId, cost]
      );
      return { id: bRes.rows[0]!.id, sessionId, status: 'confirmed' as const, creditsCharged: cost, remainingCredits: user.credits - cost, createdAt: new Date(bRes.rows[0]!.created_at).toISOString() };
    });

    return reply.status(201).send(res);
  });

  fastify.delete<{ Params: { id: string }; Reply: S['CancelBookingResponse'] | S['ErrorResponse'] }>('/bookings/:id', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { id } = request.params;
    if (!id || !UUID_REGEX.test(id)) {
      return reply.status(400).send({ error: { code: 'INVALID_BOOKING_ID', message: 'El id de reserva proporcionado no es un UUID válido.' } });
    }

    const res = await withTransaction(fastify.db, async (client) => {
      const bRes = await client.query<DbBookingLockRow>(`SELECT id, user_id, session_id, status, credits_charged FROM bookings WHERE id = $1 FOR UPDATE;`, [id]);
      const b = bRes.rows[0];
      if (!b) throw new ApiError(404, 'BOOKING_NOT_FOUND', 'No se encontró ninguna reserva con el identificador indicado.');
      if (b.user_id !== request.user.sub) throw new ApiError(403, 'FORBIDDEN', 'No tienes autorización para cancelar una reserva que pertenece a otro usuario.');
      if (b.status === 'cancelled') throw new ApiError(400, 'BOOKING_ALREADY_CANCELLED', 'La reserva seleccionada ya fue cancelada previamente.');

      const uRes = await client.query<{ credits: number }>(`SELECT credits FROM users WHERE id = $1 FOR UPDATE;`, [request.user.sub]);
      await client.query(`SELECT id FROM sessions WHERE id = $1 FOR UPDATE;`, [b.session_id]);
      const uBkg = await client.query<{ cancelled_at: Date | string }>(`UPDATE bookings SET status = 'cancelled', cancelled_at = now() WHERE id = $1 RETURNING cancelled_at;`, [id]);
      const refund = Number(b.credits_charged);
      const uUser = await client.query<{ credits: number }>(`UPDATE users SET credits = credits + $1 WHERE id = $2 RETURNING credits;`, [refund, request.user.sub]);
      await client.query(`UPDATE sessions SET available_slots = available_slots + 1 WHERE id = $1;`, [b.session_id]);

      return {
        message: 'Reserva cancelada correctamente. Créditos reembolsados a tu saldo.',
        bookingId: b.id,
        creditsRefunded: refund,
        newCreditBalance: Number(uUser.rows[0]?.credits ?? (uRes.rows[0]?.credits ?? 0) + refund),
        cancelledAt: new Date(uBkg.rows[0]?.cancelled_at ?? new Date()).toISOString(),
      };
    });

    return reply.status(200).send(res);
  });
};
