import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import fastifyCors from '@fastify/cors';
import { authRoutes } from './routes/auth.js';
import { sessionRoutes } from './routes/sessions.js';
import { bookingRoutes } from './routes/bookings.js';
import { studioRoutes } from './routes/studio.js';
import { initializeDatabasePool, ApiError } from './db.js';
import type { paths, components } from './types/api.js';

export type UserProfile = components['schemas']['UserProfile'];
export type SessionDetail = components['schemas']['SessionDetailResponse'];
export type ApiPaths = paths;

export interface ServerOptions {
  pool?: pg.Pool;
  logger?: boolean;
  jwtSecret?: string;
  cookieSecret?: string;
}

export interface HealthStatus {
  status: 'ok' | 'degraded';
  timestamp: string;
  uptime: number;
  database: 'connected' | 'disconnected' | 'not_configured';
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  let token = request.cookies['access_token'];
  if (!token && request.headers.authorization) {
    const [scheme, val] = request.headers.authorization.trim().split(/\s+/);
    if (scheme && val && /^Bearer$/i.test(scheme)) {
      token = val;
    }
  }
  if (!token) {
    reply.status(401).send({
      error: { code: 'UNAUTHORIZED', message: 'No autenticado. Cookie de sesión access_token requerida.' },
    });
    return;
  }
  try {
    request.user = request.server.jwt.verify<{ sub: string; role: 'client' | 'trainer' | 'admin' }>(token);
  } catch {
    reply.status(401).send({
      error: { code: 'UNAUTHORIZED', message: 'No autenticado. Cookie de sesión access_token requerida.' },
    });
    return;
  }
}

export async function buildServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  let pool = options.pool;
  let isInMemory = false;

  if (!pool) {
    const dbInit = await initializeDatabasePool();
    pool = dbInit.pool;
    isInMemory = dbInit.isInMemory;
  }

  const app = Fastify({ logger: options.logger ?? true });

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body || (typeof body === 'string' && body.trim() === '') || (Buffer.isBuffer(body) && body.length === 0)) {
      done(null, undefined);
      return;
    }
    try {
      const raw = typeof body === 'string' ? body : body.toString('utf-8');
      done(null, JSON.parse(raw));
    } catch (err: unknown) {
      done(err as Error, undefined);
    }
  });

  app.decorate('db', pool);
  app.decorate('authenticate', authenticate);

  await app.register(fastifyCors, {
    origin: (origin, cb) => {
      if (!origin || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
        cb(null, true);
        return;
      }
      cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    exposedHeaders: ['Authorization', 'Set-Cookie'],
  });

  const jwtSecret = options.jwtSecret ?? process.env['JWT_SECRET'] ?? 'default_jwt_secret_must_be_over_32_chars_long';
  const cookieSecret = options.cookieSecret ?? process.env['COOKIE_SECRET'] ?? 'default_cookie_secret_min_32_chars_long';

  await app.register(fastifyCookie, { secret: cookieSecret });
  await app.register(fastifyJwt, { secret: jwtSecret });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
    }

    if (typeof error === 'object' && error !== null && 'code' in error) {
      const pgErr = error as { code: string; constraint?: string };
      if (pgErr.code === '23505') {
        return reply.status(409).send({
          error: { code: 'DUPLICATE_BOOKING', message: 'Ya dispones de una reserva confirmada para esta sesión.' },
        });
      }
      if (pgErr.code === '23514') {
        if (pgErr.constraint === 'sessions_slots_non_negative') {
          return reply.status(409).send({
            error: { code: 'SLOTS_EXHAUSTED', message: 'La sesión seleccionada no tiene plazas disponibles.' },
          });
        }
        if (pgErr.constraint === 'users_credits_non_negative') {
          return reply.status(403).send({
            error: { code: 'INSUFFICIENT_CREDITS', message: 'Saldo de créditos insuficiente.' },
          });
        }
        if (pgErr.constraint === 'artworks_stock_non_negative') {
          return reply.status(409).send({
            error: { code: 'STOCK_EXHAUSTED', message: 'La pieza seleccionada ya no tiene stock disponible (pieza única vendida).' },
          });
        }
      }
    }

    request.log.error(error);
    return reply.status(500).send({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Error interno del servidor al procesar la reserva.' },
    });
  });

  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(sessionRoutes, { prefix: '/api/v1' });
  await app.register(bookingRoutes, { prefix: '/api/v1' });
  await app.register(studioRoutes, { prefix: '/api/v1' });

  app.addHook('onClose', async () => {
    await pool.end();
  });

  app.get<{ Reply: HealthStatus }>('/health', async (_request, reply) => {
    let dbStatus: HealthStatus['database'] = 'not_configured';
    try {
      const client = await pool.connect();
      await client.query('SELECT 1;');
      client.release();
      dbStatus = 'connected';
    } catch {
      dbStatus = 'disconnected';
    }

    const isHealthy = dbStatus === 'connected';
    return reply.status(isHealthy ? 200 : 503).send({
      status: isHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: dbStatus,
    });
  });

  if (isInMemory && (options.logger ?? true)) {
    app.log.info(
      'ℹ️ PostgreSQL no detectado en puerto 5432. Modo desarrollo activo: usando base de datos en memoria precargada con specs/schema.sql'
    );
  }

  return app;
}

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectExecution) {
  try {
    if (typeof process.loadEnvFile === 'function') {
      try {
        process.loadEnvFile();
      } catch {
        // .env ya cargado o no presente
      }
    }

    const server = await buildServer();
    const port = Number(process.env['PORT'] ?? 3000);
    const host = process.env['HOST'] ?? '0.0.0.0';

    await server.listen({ port, host });
    server.log.info(`Servidor escuchando en http://${host}:${port}`);
  } catch (err: unknown) {
    console.error('Error al iniciar el servidor:', err);
    process.exit(1);
  }
}
