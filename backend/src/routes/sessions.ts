import type { FastifyPluginAsync } from 'fastify';
import type { components } from '../types/api.js';

type S = components['schemas'];
interface GetSessionsQuery { from?: string; to?: string; activity_type_id?: string; }
interface SessionAttendeeItem { bookingId: string; userId: string; fullName: string; email: string; createdAt: string; }
interface DbSessionRow {
  session_id: string; starts_at: Date | string; ends_at: Date | string; max_capacity: number; available_slots: number;
  activity_id: string; activity_name: string; activity_description: string | null; activity_duration: number;
  activity_credit_cost: number; activity_color: string; trainer_id: string; trainer_name: string;
}

export const sessionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: GetSessionsQuery; Reply: S['SessionDetailResponse'][] | S['ErrorResponse'] }>(
    '/sessions',
    async (request, reply) => {
      const { from, to, activity_type_id } = request.query;
      if (!from || !to) {
        return reply.status(400).send({ error: { code: 'MISSING_DATE_RANGE', message: "Los parámetros de consulta 'from' y 'to' son obligatorios en formato ISO 8601." } });
      }

      const fromDate = new Date(from);
      const toDate = new Date(to);
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return reply.status(400).send({ error: { code: 'INVALID_DATE_FORMAT', message: "Formato de fecha inválido para 'from' o 'to'. Use formato ISO 8601." } });
      }
      if (fromDate > toDate) {
        return reply.status(400).send({ error: { code: 'INVALID_DATE_RANGE', message: "La fecha 'from' debe ser anterior o igual a 'to'." } });
      }

      let sql = `SELECT s.id AS session_id, s.starts_at, s.ends_at, s.max_capacity, s.available_slots,
                        at.id AS activity_id, at.name AS activity_name, at.description AS activity_description,
                        at.duration_minutes AS activity_duration, at.credit_cost AS activity_credit_cost,
                        at.color AS activity_color, u.id AS trainer_id, u.full_name AS trainer_name
                 FROM sessions s
                 JOIN activity_types at ON at.id = s.activity_type_id
                 JOIN users u ON u.id = s.trainer_id
                 WHERE s.starts_at >= $1 AND s.starts_at <= $2`;

      const params: (string | Date)[] = [fromDate.toISOString(), toDate.toISOString()];
      if (activity_type_id) {
        params.push(activity_type_id);
        sql += ` AND s.activity_type_id = $${params.length}`;
      }
      sql += ' ORDER BY s.starts_at ASC;';

      const result = await fastify.db.query<DbSessionRow>(sql, params);
      return reply.status(200).send(
        result.rows.map((row) => ({
          id: row.session_id,
          startsAt: new Date(row.starts_at).toISOString(),
          endsAt: new Date(row.ends_at).toISOString(),
          maxCapacity: Number(row.max_capacity),
          availableSlots: Number(row.available_slots),
          activityType: {
            id: row.activity_id,
            name: row.activity_name,
            description: row.activity_description,
            durationMinutes: Number(row.activity_duration),
            creditCost: Number(row.activity_credit_cost),
            color: row.activity_color,
          },
          trainer: { id: row.trainer_id, fullName: row.trainer_name },
        }))
      );
    }
  );

  fastify.get<{ Params: { id: string }; Reply: SessionAttendeeItem[] | S['ErrorResponse'] }>(
    '/sessions/:id/attendees',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      if (request.user.role !== 'admin' && request.user.role !== 'trainer') {
        return reply.status(403).send({ error: { code: 'FORBIDDEN', message: "Acceso restringido. Se requiere rol 'admin' o 'trainer'." } });
      }
      const { id } = request.params;
      const res = await fastify.db.query<{ booking_id: string; user_id: string; full_name: string; email: string; created_at: Date | string }>(
        `SELECT b.id AS booking_id, u.id AS user_id, u.full_name, u.email, b.created_at
         FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.session_id = $1 AND b.status = 'confirmed' ORDER BY b.created_at ASC;`,
        [id]
      );
      return reply.status(200).send(
        res.rows.map((r) => ({
          bookingId: r.booking_id,
          userId: r.user_id,
          fullName: r.full_name,
          email: r.email,
          createdAt: new Date(r.created_at).toISOString(),
        }))
      );
    }
  );
};
