/** Public option, handler, and framework-shape types for the dashboard middleware. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PortQueue } from '@portqueue/core';
import type { DashboardAuth } from './api/auth.js';

export interface DashboardOptions {
  /** The developer's running PortQueue instance. The dashboard rides on it. */
  portQueue: PortQueue;
  /** Mount path (default `/portqueue`). */
  basePath?: string;
  /** Pluggable auth guard (default: none). */
  auth?: DashboardAuth;
  /** Disable all mutating actions server-side. */
  readOnly?: boolean;
  /** Header/title text. */
  title?: string;
  /** Initial theme preference for the SPA. */
  theme?: 'light' | 'dark' | 'system';
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
}
