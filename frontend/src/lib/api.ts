import createClient from 'openapi-fetch';
import type { paths, components as C } from '../types/api.js';

export type UserProfile = C['schemas']['UserProfile']; export type SessionDetail = C['schemas']['SessionDetailResponse'];
export type BookingConfirmed = C['schemas']['BookingConfirmedResponse']; export type UserBookingItem = C['schemas']['UserBookingItem'];
export type CancelBookingResponse = C['schemas']['CancelBookingResponse']; export type ErrorDetail = C['schemas']['ErrorDetail'];
export type ActivityTypeInfo = C['schemas']['ActivityTypeInfo']; export type ClientUserItem = C['schemas']['ClientUserItem'];
export type SessionAttendeeItem = C['schemas']['SessionAttendeeItem']; export type ArtworkResponse = C['schemas']['ArtworkResponse'];
export type BuyArtworkResponse = C['schemas']['BuyArtworkResponse']; export type CreateArtworkRequest = C['schemas']['CreateArtworkRequest'];

export const API_BASE_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || 'http://localhost:3000';
const remote = createClient<paths>({ baseUrl: API_BASE_URL, credentials: 'include', headers: { 'Content-Type': 'application/json' } });
const T = (d: number, h: number, m = 0) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, m, 0, 0); return x.toISOString(); };

const D_ACTS: ActivityTypeInfo[] = [{ id: 'a-1', name: 'Torno Alfarero · Semanal', durationMinutes: 120, creditCost: 1, color: '#C47451', description: 'Torno' }, { id: 'a-2', name: 'Modelado y Engobes BOTZ', durationMinutes: 90, creditCost: 1, color: '#7C8471', description: 'Planchas' }, { id: 'a-3', name: 'Monográfico Esmaltes 1250°C', durationMinutes: 180, creditCost: 2, color: '#2546A8', description: 'Alta temp' }];
const D_USERS: UserProfile[] = [{ id: 'c0000000-0000-0000-0000-000000000001', email: 'sofia.alumna@example.com', fullName: 'Sofía Valero', role: 'client', credits: 4 }, { id: 'b0000000-0000-0000-0000-000000000001', email: 'carmen.profesora@tallerbarro.com', fullName: 'Beatriz Tabliega', role: 'trainer', credits: 0 }, { id: 'a0000000-0000-0000-0000-000000000001', email: 'admin@tallerbarro.com', fullName: 'Elena Gómez (Admin)', role: 'admin', credits: 0 }];
const D_ARTS: ArtworkResponse[] = [
  { id: 'art-1', title: 'Jarra Asa Circular · Serie Klein', category: 'Jarras', priceEur: 85, stock: 1, glazeFinish: 'Gres blanco y azul cobalto', paletteHex: '#2546A8', imageUrl: 'media/obras/jarras-klein.jpg' },
  { id: 'art-2', title: 'Escultura Disco Acanalado · Óxidos', category: 'Escultura', priceEur: 130, stock: 1, glazeFinish: 'Gres texturizado pátina oro', paletteHex: '#8C7A5B', imageUrl: 'media/obras/disco-oxidos.jpg' },
  { id: 'art-3', title: 'Vasija Orgánica Asa Anillo', category: 'Vasijas', priceEur: 70, stock: 2, glazeFinish: 'Terracota bruñida alta temp', paletteHex: '#C47451', imageUrl: 'media/obras/disco-siena.jpg' },
  { id: 'art-4', title: 'Set 2 Tazas Torno · Engobe Lima', category: 'Menaje', priceEur: 48, stock: 4, glazeFinish: 'Gres torneado engobe BOTZ', paletteHex: '#7C8471', imageUrl: 'media/obras/tazas-terracota.jpg' },
  { id: 'art-5', title: 'Equilibrio Cobalto · Escultura', category: 'Escultura', priceEur: 95, stock: 1, glazeFinish: 'Gres chamotado azul mate', paletteHex: '#2546A8', imageUrl: 'media/obras/equilibrio-cobalto.jpg' },
  { id: 'art-6', title: 'Trío Floreros Tulipán · Serie Luna', category: 'Vasijas', priceEur: 115, stock: 2, glazeFinish: 'Porcelana blanco satinado', paletteHex: '#231F1E', imageUrl: 'media/obras/trio-tulipan.jpg' }
];
const D_SESS: SessionDetail[] = [
  { id: 's-1', startsAt: T(1, 10), endsAt: T(1, 12), maxCapacity: 6, availableSlots: 1, activityType: D_ACTS[0], trainer: { id: 'u-2', fullName: 'Beatriz Tabliega' } },
  { id: 's-2', startsAt: T(1, 16), endsAt: T(1, 17, 30), maxCapacity: 10, availableSlots: 8, activityType: D_ACTS[1], trainer: { id: 'u-2', fullName: 'Beatriz Tabliega' } },
  { id: 's-3', startsAt: T(2, 11), endsAt: T(2, 14), maxCapacity: 8, availableSlots: 5, activityType: D_ACTS[2], trainer: { id: 'u-2', fullName: 'Beatriz Tabliega' } }
];

const DB_KEY = 'bt_studio_db_v1';
const getDB = () => { try { const s = localStorage.getItem(DB_KEY); if (s) return JSON.parse(s); } catch {} const init = { users: D_USERS, acts: D_ACTS, arts: D_ARTS, sess: D_SESS, bks: [] as UserBookingItem[] }; try { localStorage.setItem(DB_KEY, JSON.stringify(init)); } catch {} return init; };
const saveDB = (db: any) => { try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch {} };
export const resetLocalData = () => { localStorage.removeItem(DB_KEY); sessionStorage.clear(); window.location.reload(); };
const getCurUser = (db: any): UserProfile => { try { const s = sessionStorage.getItem('timp_ceramica_user_profile'); if (s) return JSON.parse(s); } catch {} return db.users[0]; };

const ok = (data: any) => ({ data, error: null, response: new Response() });
const err = (message: string, status = 400) => ({ data: null, error: { error: { message } }, response: new Response(null, { status }) });

const localExec = (m: string, p: string, o?: any) => {
  const db = getDB(); const u = getCurUser(db);
  if (p === '/auth/login') {
    const em = (o?.body?.email || '').toLowerCase().trim();
    const found = db.users.find((x: any) => x.email.toLowerCase() === em) || (em.includes('admin') ? db.users[2] : em.includes('carmen') || em.includes('prof') ? db.users[1] : db.users[0]);
    sessionStorage.setItem('timp_ceramica_user_profile', JSON.stringify(found));
    return ok({ user: found, message: 'Sesión local iniciada' });
  }
  if (p === '/api/v1/sessions') {
    if (m === 'GET') return ok(db.sess);
    const act = db.acts.find((a: any) => a.id === o.body.activityTypeId) || db.acts[0];
    const s: SessionDetail = { id: 's-' + Date.now(), startsAt: o.body.startsAt, endsAt: o.body.endsAt, maxCapacity: o.body.maxCapacity, availableSlots: o.body.maxCapacity, activityType: act, trainer: { id: u.id, fullName: u.fullName } };
    db.sess.unshift(s); saveDB(db); return ok(s);
  }
  if (p === '/api/v1/sessions/{id}/attendees') {
    const sid = o?.params?.path?.id;
    return ok(db.bks.filter((b: any) => b.sessionId === sid && b.status === 'confirmed').map((b: any) => ({ bookingId: b.id, userId: 'u-1', fullName: 'Sofía Valero', email: 'sofia.alumna@example.com', bookedAt: b.createdAt })));
  }
  if (p === '/api/v1/bookings/me') return ok(db.bks.filter((b: any) => b.session && (b as any).userId === u.id));
  if (p === '/api/v1/bookings' && m === 'POST') {
    const s = db.sess.find((x: any) => x.id === o.body.sessionId);
    if (!s || s.availableSlots <= 0) return err('Sin plazas disponibles', 409);
    if (u.credits < s.activityType.creditCost) return err('Créditos insuficientes', 403);
    s.availableSlots--; u.credits -= s.activityType.creditCost;
    const curU = db.users.find((x: any) => x.id === u.id); if (curU) curU.credits = u.credits;
    sessionStorage.setItem('timp_ceramica_user_profile', JSON.stringify(u));
    const bk = { id: 'b-' + Date.now(), userId: u.id, sessionId: s.id, status: 'confirmed', creditsCharged: s.activityType.creditCost, createdAt: new Date().toISOString(), cancelledAt: null, session: s };
    db.bks.unshift(bk); saveDB(db); return ok({ id: bk.id, remainingCredits: u.credits, status: 'confirmed' });
  }
  if (p === '/api/v1/bookings/{id}' && m === 'DELETE') {
    const id = o?.params?.path?.id; const b = db.bks.find((x: any) => x.id === id);
    if (!b || b.status === 'cancelled') return err('Reserva ya cancelada');
    b.status = 'cancelled'; b.cancelledAt = new Date().toISOString();
    const s = db.sess.find((x: any) => x.id === b.sessionId); if (s) s.availableSlots++;
    u.credits += b.creditsCharged; const curU = db.users.find((x: any) => x.id === u.id); if (curU) curU.credits = u.credits;
    sessionStorage.setItem('timp_ceramica_user_profile', JSON.stringify(u));
    saveDB(db); return ok({ newCreditBalance: u.credits, creditsRefunded: b.creditsCharged });
  }
  if (p === '/api/v1/activity-types') return ok(db.acts);
  if (p === '/api/v1/users/clients') return ok(db.users.filter((x: any) => x.role === 'client'));
  if (p === '/api/v1/users/{id}/credits') {
    const id = o?.params?.path?.id; const target = db.users.find((x: any) => x.id === id);
    if (target) { target.credits += Number(o?.body?.delta || 0); saveDB(db); return ok({ id, credits: target.credits }); }
    return err('Alumno no encontrado', 404);
  }
  if (p === '/api/v1/artworks') {
    if (m === 'GET') return ok(db.arts);
    const art: ArtworkResponse = { id: 'art-' + Date.now(), ...o.body, stock: Number(o.body.stock || 1), priceEur: Number(o.body.priceEur || 85) };
    db.arts.unshift(art); saveDB(db); return ok(art);
  }
  if (p === '/api/v1/artworks/{id}' && m === 'DELETE') {
    db.arts = db.arts.filter((a: any) => a.id !== o?.params?.path?.id); saveDB(db); return ok({ ok: true });
  }
  if (p === '/api/v1/artworks/{id}/buy') {
    const a = db.arts.find((x: any) => x.id === o?.params?.path?.id);
    if (!a || a.stock <= 0) return err('Stock agotado', 409);
    a.stock--; saveDB(db); return ok({ orderRef: 'BT-' + Date.now().toString().slice(-5), remainingStock: a.stock });
  }
  return ok(null);
};

const dispatch = async (m: 'GET' | 'POST' | 'DELETE', p: string, o?: any) => {
  if (typeof window !== 'undefined' && window.location.host.includes('localhost')) {
    try {
      const res = await (remote as any)[m](p, o);
      if (res.response && res.response.status < 500) return res;
    } catch {}
  }
  return localExec(m, p, o);
};

export const api = { GET: (p: any, o?: any) => dispatch('GET', p, o), POST: (p: any, o?: any) => dispatch('POST', p, o), DELETE: (p: any, o?: any) => dispatch('DELETE', p, o), use: () => {} };
export default api;