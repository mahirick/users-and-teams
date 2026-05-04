// Admin Fastify plugin. Routes are gated on request.user.role === 'admin'.

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import {
  NotAuthorizedError,
  UserNotFoundError,
  UsersAndTeamsError,
} from '../core/errors.js';
import type { Repository } from '../core/repository.js';
import type { User } from '../core/types.js';
import {
  deleteUser,
  getUserDetail,
  listAuditLog,
  listUsers,
  suspendUser,
  unsuspendUser,
  updateUser,
} from './operations.js';

export interface AdminPluginOptions {
  repository: Repository;
  /** Override the role check (default: requires user.role === 'admin'). */
  requireRole?: (user: User) => boolean;
}

const updateUserSchema = z
  .object({
    displayName: z.string().nullable().optional(),
    role: z.enum(['user', 'admin']).optional(),
    status: z.enum(['active', 'suspended', 'deleted']).optional(),
    email: z.string().email().optional(),
  })
  .strict();

const adminPluginAsync: FastifyPluginAsync<AdminPluginOptions> = async (
  fastify: FastifyInstance,
  options: AdminPluginOptions,
) => {
  const requireRole = options.requireRole ?? ((u: User) => u.role === 'admin');

  function requireAdminUser(req: FastifyRequest): User {
    if (!req.user) {
      const err: Error & { statusCode?: number } = new Error('Authentication required');
      err.statusCode = 401;
      throw err;
    }
    if (!requireRole(req.user)) {
      throw new NotAuthorizedError('Admin role required');
    }
    return req.user;
  }

  fastify.setErrorHandler((err, _req, reply) => {
    if (err instanceof NotAuthorizedError) {
      reply.code(403);
      return { error: err.code, message: err.message };
    }
    if (err instanceof UserNotFoundError) {
      reply.code(404);
      return { error: err.code, message: err.message };
    }
    if (err instanceof UsersAndTeamsError) {
      reply.code(400);
      return { error: err.code, message: err.message };
    }
    fastify.log.error(err);
    const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
    const message = err instanceof Error ? err.message : 'Unknown error';
    reply.code(statusCode);
    return { error: 'internal_error', message };
  });

  // ---- GET /admin/users ----
  fastify.get('/admin/users', async (req) => {
    const actor = requireAdminUser(req);
    const query = z
      .object({
        search: z.string().optional(),
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(200).optional(),
      })
      .parse(req.query);

    const input: Parameters<typeof listUsers>[0] = { repo: options.repository, actor };
    if (query.search !== undefined) input.search = query.search;
    if (query.page !== undefined) input.page = query.page;
    if (query.pageSize !== undefined) input.pageSize = query.pageSize;

    return listUsers(input);
  });

  // ---- GET /admin/users/:id ----
  fastify.get<{ Params: { id: string } }>('/admin/users/:id', async (req) => {
    const actor = requireAdminUser(req);
    return getUserDetail({ repo: options.repository, actor, userId: req.params.id });
  });

  // ---- PATCH /admin/users/:id ----
  fastify.patch<{ Params: { id: string } }>('/admin/users/:id', async (req, reply) => {
    const actor = requireAdminUser(req);
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload', issues: parsed.error.issues };
    }
    const input: Parameters<typeof updateUser>[0] = {
      repo: options.repository,
      actor,
      userId: req.params.id,
    };
    if (parsed.data.displayName !== undefined) input.displayName = parsed.data.displayName;
    if (parsed.data.role !== undefined) input.role = parsed.data.role;
    if (parsed.data.status !== undefined) input.status = parsed.data.status;
    if (parsed.data.email !== undefined) input.email = parsed.data.email;
    const user = await updateUser(input);
    return { user };
  });

  // ---- POST /admin/users/:id/suspend ----
  fastify.post<{ Params: { id: string } }>('/admin/users/:id/suspend', async (req) => {
    const actor = requireAdminUser(req);
    const user = await suspendUser({
      repo: options.repository,
      actor,
      userId: req.params.id,
    });
    return { user };
  });

  // ---- POST /admin/users/:id/unsuspend ----
  fastify.post<{ Params: { id: string } }>('/admin/users/:id/unsuspend', async (req) => {
    const actor = requireAdminUser(req);
    const user = await unsuspendUser({
      repo: options.repository,
      actor,
      userId: req.params.id,
    });
    return { user };
  });

  // ---- DELETE /admin/users/:id ----
  fastify.delete<{ Params: { id: string } }>('/admin/users/:id', async (req) => {
    const actor = requireAdminUser(req);
    await deleteUser({
      repo: options.repository,
      actor,
      userId: req.params.id,
    });
    return { ok: true };
  });

  // ---- GET /admin/audit-log ----
  fastify.get('/admin/audit-log', async (req) => {
    const actor = requireAdminUser(req);
    const query = z
      .object({
        action: z.string().optional(),
        actorId: z.string().optional(),
        targetId: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      })
      .parse(req.query);

    const input: Parameters<typeof listAuditLog>[0] = { repo: options.repository, actor };
    if (query.action !== undefined) input.action = query.action;
    if (query.actorId !== undefined) input.actorId = query.actorId;
    if (query.targetId !== undefined) input.targetId = query.targetId;
    if (query.limit !== undefined) input.limit = query.limit;
    const entries = await listAuditLog(input);
    return { entries };
  });
};

export const adminPlugin = fp(adminPluginAsync, {
  name: 'users-and-teams-admin',
  fastify: '5.x',
  dependencies: ['users-and-teams-auth'],
});
