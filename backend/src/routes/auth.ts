import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import argon2 from 'argon2';
import crypto from 'node:crypto';
import type { components } from '../types/api.js';
import { withTransaction } from '../db.js';

type S = components['schemas'];

interface DbUserRow { id: string; email: string; password_hash: string; full_name: string; role: 'client' | 'trainer' | 'admin'; credits: number; is_active: boolean; }
interface DbRefreshTokenRow { id: string; user_id: string; expires_at: Date | string; revoked_at: Date | string | null; role: 'client' | 'trainer' | 'admin'; is_active: boolean; }

const ACCESS_TOKEN_MAX_AGE_SECONDS = 15 * 60;
const REFRESH_TOKEN_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const isProd = process.env['NODE_ENV'] === 'production';

const setAuthCookies = (reply: FastifyReply, access: string, refresh: string) => {
  const sameSite = (isProd ? 'strict' : 'lax') as 'strict' | 'lax';
  reply.setCookie('access_token', access, { path: '/', httpOnly: true, secure: isProd, sameSite, maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS });
  reply.setCookie('refresh_token', refresh, { path: '/', httpOnly: true, secure: isProd, sameSite, maxAge: REFRESH_TOKEN_MAX_AGE_SECONDS });
  reply.header('Authorization', `Bearer ${access}`);
};

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: S['LoginRequest']; Reply: S['AuthSuccessResponse'] | S['ErrorResponse'] }>('/login', async (request, reply) => {
    const { email, password } = request.body ?? {};
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return reply.status(400).send({ error: { code: 'INVALID_INPUT', message: 'Email y contraseña son obligatorios.' } });
    }
    const user = (await fastify.db.query<DbUserRow>('SELECT id, email, password_hash, full_name, role, credits, is_active FROM users WHERE email = $1;', [email.toLowerCase().trim()])).rows[0];
    if (!user || !(await argon2.verify(user.password_hash, password))) {
      return reply.status(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Credenciales incorrectas.' } });
    }
    if (!user.is_active) {
      return reply.status(401).send({ error: { code: 'ACCOUNT_DEACTIVATED', message: 'La cuenta de usuario está desactivada.' } });
    }
    const accessToken = fastify.jwt.sign({ sub: user.id, role: user.role }, { expiresIn: `${ACCESS_TOKEN_MAX_AGE_SECONDS}s` });
    const rawRefreshToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_MAX_AGE_SECONDS * 1000);
    await fastify.db.query('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3);', [user.id, tokenHash, expiresAt]);
    setAuthCookies(reply, accessToken, rawRefreshToken);
    return reply.status(200).send({
      message: 'Sesión iniciada correctamente',
      user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role, credits: user.credits },
    });
  });

  fastify.post<{ Reply: S['RefreshSuccessResponse'] | S['ErrorResponse'] }>('/refresh', async (request, reply) => {
    const rawRefreshToken = request.cookies['refresh_token'];
    if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
      return reply.status(401).send({ error: { code: 'REFRESH_TOKEN_REQUIRED', message: 'No se encontró la cookie de refresh token.' } });
    }
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const tokenRow = (await fastify.db.query<DbRefreshTokenRow>('SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked_at, u.role, u.is_active FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id WHERE rt.token_hash = $1;', [tokenHash])).rows[0];
    if (!tokenRow) return reply.status(401).send({ error: { code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token no válido.' } });
    if (tokenRow.revoked_at !== null || !tokenRow.is_active) {
      await fastify.db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL;', [tokenRow.user_id]);
      const sameSite = (isProd ? 'strict' : 'lax') as 'strict' | 'lax';
      reply.clearCookie('access_token', { path: '/', httpOnly: true, secure: isProd, sameSite });
      reply.clearCookie('refresh_token', { path: '/', httpOnly: true, secure: isProd, sameSite });
      const code = tokenRow.revoked_at !== null ? 'TOKEN_REUSE_DETECTED' : 'ACCOUNT_DEACTIVATED';
      return reply.status(401).send({ error: { code, message: 'Sesión no válida o revocada.' } });
    }
    if (new Date(tokenRow.expires_at).getTime() <= Date.now()) {
      return reply.status(401).send({ error: { code: 'REFRESH_TOKEN_EXPIRED', message: 'El refresh token ha expirado. Inicia sesión nuevamente.' } });
    }
    const newRawRefreshToken = await withTransaction(fastify.db, async (client) => {
      await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1;', [tokenRow.id]);
      const nextRaw = crypto.randomBytes(32).toString('hex');
      const nextHash = crypto.createHash('sha256').update(nextRaw).digest('hex');
      const nextExp = new Date(Date.now() + REFRESH_TOKEN_MAX_AGE_SECONDS * 1000);
      await client.query('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3);', [tokenRow.user_id, nextHash, nextExp]);
      return nextRaw;
    });
    const newAccessToken = fastify.jwt.sign({ sub: tokenRow.user_id, role: tokenRow.role }, { expiresIn: `${ACCESS_TOKEN_MAX_AGE_SECONDS}s` });
    setAuthCookies(reply, newAccessToken, newRawRefreshToken);
    return reply.status(200).send({ message: 'Sesión renovada con éxito' });
  });

  fastify.post('/logout', async (request, reply) => {
    const rawRefreshToken = request.cookies['refresh_token'];
    if (rawRefreshToken && typeof rawRefreshToken === 'string') {
      const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
      await fastify.db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1;', [tokenHash]).catch(() => {});
    }
    const sameSite = (isProd ? 'strict' : 'lax') as 'strict' | 'lax';
    reply.clearCookie('access_token', { path: '/', httpOnly: true, secure: isProd, sameSite });
    reply.clearCookie('refresh_token', { path: '/', httpOnly: true, secure: isProd, sameSite });
    return reply.status(200).send({ message: 'Sesión cerrada correctamente' });
  });
};
