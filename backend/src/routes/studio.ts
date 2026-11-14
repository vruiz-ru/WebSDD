import type { FastifyPluginAsync } from 'fastify';
import type { components } from '../types/api.js';
import { withTransaction, ApiError } from '../db.js';

type S = components['schemas'];

export const studioRoutes: FastifyPluginAsync = async (f) => {
  const auth = { preHandler: [f.authenticate] };
  const checkRole = (u: { role?: string } | undefined, roles: string[]) => {
    if (!u?.role || !roles.includes(u.role)) throw new ApiError(403, 'FORBIDDEN', 'Acceso no autorizado para este rol.');
  };

  f.get<{ Reply: S['ActivityTypeInfo'][] }>('/activity-types', async (_r, rep) => {
    const res = await f.db.query<{ id: string; name: string; description: string | null; duration_minutes: number; credit_cost: number; color: string }>(
      'SELECT id, name, description, duration_minutes, credit_cost, color FROM activity_types WHERE is_active = true ORDER BY name ASC;'
    );
    return rep.send(res.rows.map((r) => ({ id: r.id, name: r.name, description: r.description, durationMinutes: Number(r.duration_minutes), creditCost: Number(r.credit_cost), color: r.color })));
  });

  f.post<{ Body: S['CreateSessionRequest']; Reply: S['SessionDetailResponse'] }>('/sessions', auth, async (req, rep) => {
    checkRole(req.user, ['admin', 'trainer']);
    const { activityTypeId, startsAt, endsAt, maxCapacity, trainerId } = req.body ?? {};
    if (!activityTypeId || !startsAt || !endsAt || !maxCapacity || maxCapacity <= 0) throw new ApiError(400, 'INVALID_INPUT', 'Datos incompletos.');
    const start = new Date(startsAt), end = new Date(endsAt);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) throw new ApiError(400, 'INVALID_INPUT', 'Fechas inválidas.');
    const tId = req.user.role === 'trainer' ? req.user.sub : (trainerId || req.user.sub);
    const ins = await f.db.query<{ id: string }>(
      'INSERT INTO sessions (activity_type_id, trainer_id, starts_at, ends_at, max_capacity, available_slots) VALUES ($1, $2, $3, $4, $5, $5) RETURNING id;',
      [activityTypeId, tId, start.toISOString(), end.toISOString(), maxCapacity]
    );
    const s = (await f.db.query<{ session_id: string; starts_at: Date | string; ends_at: Date | string; max_capacity: number; available_slots: number; activity_id: string; activity_name: string; activity_description: string | null; activity_duration: number; activity_credit_cost: number; activity_color: string; trainer_id: string; trainer_name: string }>(
      `SELECT s.id AS session_id, s.starts_at, s.ends_at, s.max_capacity, s.available_slots, at.id AS activity_id, at.name AS activity_name, at.description AS activity_description, at.duration_minutes AS activity_duration, at.credit_cost AS activity_credit_cost, at.color AS activity_color, u.id AS trainer_id, u.full_name AS trainer_name FROM sessions s JOIN activity_types at ON at.id = s.activity_type_id JOIN users u ON u.id = s.trainer_id WHERE s.id = $1;`,
      [ins.rows[0]?.id]
    )).rows[0];
    if (!s) throw new ApiError(400, 'SESSION_CREATION_FAILED', 'Error al crear la sesión.');
    return rep.status(201).send({
      id: s.session_id, startsAt: new Date(s.starts_at).toISOString(), endsAt: new Date(s.ends_at).toISOString(),
      maxCapacity: Number(s.max_capacity), availableSlots: Number(s.available_slots),
      activityType: { id: s.activity_id, name: s.activity_name, description: s.activity_description, durationMinutes: Number(s.activity_duration), creditCost: Number(s.activity_credit_cost), color: s.activity_color },
      trainer: { id: s.trainer_id, fullName: s.trainer_name },
    });
  });

  f.get<{ Reply: S['ClientUserItem'][] }>('/users/clients', auth, async (req, rep) => {
    checkRole(req.user, ['admin']);
    const res = await f.db.query<{ id: string; full_name: string; email: string; credits: number }>("SELECT id, full_name, email, credits FROM users WHERE role = 'client' AND is_active = true ORDER BY full_name ASC;");
    return rep.send(res.rows.map((u) => ({ id: u.id, fullName: u.full_name, email: u.email, credits: Number(u.credits) })));
  });

  f.post<{ Params: { id: string }; Body: S['AddCreditsRequest']; Reply: S['UserCreditsUpdatedResponse'] }>('/users/:id/credits', auth, async (req, rep) => {
    checkRole(req.user, ['admin']);
    const { delta } = req.body ?? {};
    if (!delta || delta <= 0 || !Number.isInteger(delta)) throw new ApiError(400, 'INVALID_DELTA', 'El incremento de créditos debe ser un entero positivo.');
    const res = await withTransaction(f.db, async (client) => {
      const u = (await client.query<{ id: string; full_name: string; credits: number; role: string }>('SELECT id, full_name, credits, role FROM users WHERE id = $1 FOR UPDATE;', [req.params.id])).rows[0];
      if (!u) throw new ApiError(404, 'USER_NOT_FOUND', 'Alumno no encontrado.');
      if (u.role !== 'client') throw new ApiError(400, 'USER_NOT_CLIENT', 'Solo clientes pueden tener créditos.');
      const up = await client.query<{ credits: number }>('UPDATE users SET credits = credits + $1 WHERE id = $2 RETURNING credits;', [delta, req.params.id]);
      return { id: u.id, fullName: u.full_name, credits: Number(up.rows[0]?.credits ?? u.credits + delta), message: 'Saldo de créditos actualizado exitosamente' };
    });
    return rep.send(res);
  });

  f.get<{ Reply: S['ArtworkResponse'][] }>('/artworks', async (_req, rep) => {
    const res = await f.db.query<{ id: string; title: string; category: string; price_eur: number; stock: number; glaze_finish: string; palette_hex: string; image_url: string | null }>(
      'SELECT id, title, category, price_eur, stock, glaze_finish, palette_hex, image_url FROM artworks WHERE is_active = true ORDER BY created_at ASC;'
    );
    return rep.send(res.rows.map((a) => ({ id: a.id, title: a.title, category: a.category, priceEur: Number(a.price_eur), stock: Number(a.stock), glazeFinish: a.glaze_finish, paletteHex: a.palette_hex, imageUrl: a.image_url ?? null })));
  });

  f.post<{ Params: { id: string }; Body: S['BuyArtworkRequest']; Reply: S['BuyArtworkResponse'] }>('/artworks/:id/buy', async (req, rep) => {
    const { buyerName, buyerEmail } = req.body ?? {};
    if (!buyerName || !buyerEmail) throw new ApiError(400, 'INVALID_INPUT', 'Nombre y email de comprador requeridos.');
    const res = await withTransaction(f.db, async (client) => {
      const art = (await client.query<{ id: string; title: string; price_eur: number; stock: number }>('SELECT id, title, price_eur, stock FROM artworks WHERE id = $1 FOR UPDATE;', [req.params.id])).rows[0];
      if (!art) throw new ApiError(404, 'ARTWORK_NOT_FOUND', 'Pieza cerámica no encontrada.');
      if (art.stock <= 0) throw new ApiError(409, 'STOCK_EXHAUSTED', 'La pieza seleccionada ya no tiene stock disponible.');
      const up = (await client.query<{ stock: number }>('UPDATE artworks SET stock = stock - 1 WHERE id = $1 RETURNING stock;', [art.id])).rows[0];
      return { message: 'Compra realizada exitosamente', orderRef: `ORD-ART-${Date.now()}-${art.id.slice(0, 8)}`, artworkId: art.id, title: art.title, priceEur: Number(art.price_eur), remainingStock: Number(up?.stock ?? art.stock - 1) };
    });
    return rep.send(res);
  });

  f.post<{ Body: S['CreateArtworkRequest']; Reply: S['ArtworkResponse'] }>('/artworks', auth, async (req, rep) => {
    checkRole(req.user, ['admin', 'trainer']);
    const { title, category, priceEur, stock, glazeFinish, paletteHex, imageUrl } = req.body ?? {};
    if (!title || !category || !priceEur || priceEur <= 0 || stock === undefined || stock < 0 || !glazeFinish || !paletteHex) {
      throw new ApiError(400, 'INVALID_INPUT', 'Datos de pieza inválidos.');
    }
    const ins = (await f.db.query<{ id: string; title: string; category: string; price_eur: number; stock: number; glaze_finish: string; palette_hex: string; image_url: string | null }>(
      'INSERT INTO artworks (title, category, price_eur, stock, glaze_finish, palette_hex, image_url) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, title, category, price_eur, stock, glaze_finish, palette_hex, image_url;',
      [title, category, priceEur, stock, glazeFinish, paletteHex, imageUrl ?? null]
    )).rows[0];
    if (!ins) throw new ApiError(400, 'ARTWORK_CREATION_FAILED', 'Error al registrar pieza.');
    return rep.status(201).send({ id: ins.id, title: ins.title, category: ins.category, priceEur: Number(ins.price_eur), stock: Number(ins.stock), glazeFinish: ins.glaze_finish, paletteHex: ins.palette_hex, imageUrl: ins.image_url ?? null });
  });

  f.delete<{ Params: { id: string }; Reply: S['DeleteArtworkResponse'] }>('/artworks/:id', auth, async (req, rep) => {
    checkRole(req.user, ['admin', 'trainer']);
    const res = await f.db.query<{ id: string }>('UPDATE artworks SET is_active = false WHERE id = $1 RETURNING id;', [req.params.id]);
    if (!res.rows[0]) throw new ApiError(404, 'ARTWORK_NOT_FOUND', 'Pieza cerámica no encontrada.');
    return rep.send({ message: 'Pieza retirada del catálogo exitosamente', artworkId: res.rows[0].id });
  });
};
