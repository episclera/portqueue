/** Public option, handler, and framework-shape types for the dashboard middleware. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Driver, Logger } from '@portqueue/core';

export interface DashboardOptions {
  /**
   * A driver pointed at the PortQueue database — and that is the whole of the wiring.
   *
   * The dashboard builds and owns its own **headless** client from this (see `server/client.ts`): it
   * declares no queues, registers no instance, runs no workers or scheduler, and never migrates. It
   * deliberately does **not** take the application's `PortQueue`: the dashboard is normally a
   * different process from the workers, so riding on their client only ever worked when the two
   * happened to share one — and it coupled an observer to a participant.
   *
   * The connection opens on the first request, not at mount.
   */
  driver: Driver;
  /** Mount path (default `/portqueue`). */
  basePath?: string;
  /**
   * Where the dashboard reports problems it can only notice at startup — most usefully a missing
   * client bundle, which otherwise looks like a working server. Defaults to `console`.
   */
  logger?: Pick<Logger, 'warn'>;
}

/** A raw-Node request handler: returns true if it handled the request. */
export type NodeHandler = (req: IncomingMessage, res: ServerResponse) => boolean;

/** Express-style middleware `(req, res, next) => void`. */
export type ExpressMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) => void;

/** Koa-style middleware `(ctx, next) => Promise<void>`. */
export type KoaMiddleware = (ctx: KoaContext, next: () => Promise<void>) => Promise<void>;

/** Fastify plugin `(fastify, opts, done) => void`. */
export type FastifyPlugin = (fastify: FastifyLike, opts: unknown, done: () => void) => void;

/**
 * NestJS functional middleware. Nest's default platform is Express, so the dashboard
 * mounts as ordinary functional middleware — no `@nestjs/*` dependency required.
 */
export type NestMiddleware = ExpressMiddleware;

/** Minimal structural Koa context (avoid a hard koa dependency). */
export interface KoaContext {
  req: IncomingMessage;
  res: ServerResponse;
  respond?: boolean;
}

/** Minimal structural Fastify instance. */
export interface FastifyLike {
  addHook: (
    name: 'onRequest',
    fn: (req: { raw: IncomingMessage }, reply: { raw: ServerResponse; hijack: () => void }) => void,
  ) => void;
}

export interface Dashboard {
  /** Raw Node: call in your handler; returns true when it served the request. */
  node: () => NodeHandler;
  /** Express middleware `(req, res, next) => void`. */
  express: () => ExpressMiddleware;
  /** Koa middleware `(ctx, next) => Promise<void>`. */
  koa: () => KoaMiddleware;
  /** Fastify plugin `(fastify, opts, done) => void`. */
  fastify: () => FastifyPlugin;
  /** NestJS functional middleware — `consumer.apply(dashboard.nest()).forRoutes(basePath)`. */
  nest: () => NestMiddleware;
  /** The resolved base path. */
  basePath: string;
  /**
   * Disconnect the dashboard's own client. Call it when the host shuts down. A no-op if no request
   * ever caused a connection, and safe to call more than once.
   */
  close: () => Promise<void>;
}
