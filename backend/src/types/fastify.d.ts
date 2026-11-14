import type pg from 'pg';
import type { FastifyRequest, FastifyReply } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    db: pg.Pool;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      role: 'client' | 'trainer' | 'admin';
    };
    user: {
      sub: string;
      role: 'client' | 'trainer' | 'admin';
    };
  }
}
