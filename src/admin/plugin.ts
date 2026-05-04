// Admin Fastify plugin. Routes are gated on request.user.role === 'owner'
// (system Owner — the cross-team superuser).

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import { NotAuthorizedError } from '../core/errors.js';
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
  /** Override the role check (default: requires user.role === 'owner'). */
  requireRole?: (user: User) => boolean;
}

const updateUserSchema = z
  .object({
    displayName: z.string().nullable().optional(),
    role: z.enum(['user', 'owner']).optional(),
    status: z.enum(['active', 'suspended', 'deleted']).optional(),
    email: z.string().email().optional(),
  })
  .strict();

const adminPluginAsync: FastifyPluginAsync<AdminPluginOptions> = async (
  fastify: FastifyInstance,
  options: AdminPluginOptions,
) => {
  const requireRole = options.requireRole ?? ((u: User) => u.role === 'owner');

  function requireOwnerUser(req: FastifyRequest): User {
    if (!req.user) {
      const err: Error & { statusCode?: number } = new Error('Authentication required');
      err.statusCode = 401;
      throw err;
    }
    if (!requireRole(req.user)) {
      throw new NotAuthorizedError('Owner role required');
    }
    return req.user;
  }

  // Error handling lives on authPlugin (shared mapUatError); declared as a
  // dependency below.

  // ---- GET /admin/users ----
  fastify.get('/admin/users', async (req) => {
    const actor = requireOwnerUser(req);
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
    const actor = requireOwnerUser(req);
    return getUserDetail({ repo: options.repository, actor, userId: req.params.id });
  });

  // ---- PATCH /admin/users/:id ----
  fastify.patch<{ Params: { id: string } }>('/admin/users/:id', async (req, reply) => {
    const actor = requireOwnerUser(req);
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
    const actor = requireOwnerUser(req);
    const user = await suspendUser({
      repo: options.repository,
      actor,
      userId: req.params.id,
    });
    return { user };
  });

  // ---- POST /admin/users/:id/unsuspend ----
  fastify.post<{ Params: { id: string } }>('/admin/users/:id/unsuspend', async (req) => {
    const actor = requireOwnerUser(req);
    const user = await unsuspendUser({
      repo: options.repository,
      actor,
      userId: req.params.id,
    });
    return { user };
  });

  // ---- DELETE /admin/users/:id ----
  fastify.delete<{ Params: { id: string } }>('/admin/users/:id', async (req) => {
    const actor = requireOwnerUser(req);
    await deleteUser({
      repo: options.repository,
      actor,
      userId: req.params.id,
    });
    return { ok: true };
  });

  // ---- GET /admin/audit-log ----
  fastify.get('/admin/audit-log', async (req) => {
    const actor = requireOwnerUser(req);
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
