// Fastify plugin for /teams/* routes. Each route checks authentication via
// request.user (populated by authPlugin's onRequest hook), then delegates to
// the operations module which enforces team-level permissions.

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import type { Repository } from '../core/repository.js';
import type { EmailTransport, RenderedEmail } from '../email/types.js';
import {
  acceptInvite,
  createTeam,
  deleteTeam,
  editTeam,
  inviteMember,
  listMembers,
  listMyTeams,
  removeMember,
  transferOwnership,
  updateMemberRole,
} from './operations.js';

export interface TeamsPluginOptions {
  repository: Repository;
  email: EmailTransport;
  siteUrl: string;
  siteName: string;
  inviteTtlDays?: number;
  inviteTemplate?: (args: {
    siteName: string;
    siteUrl: string;
    teamName: string;
    inviterName: string | null;
    inviterEmail?: string;
    link: string;
  }) => RenderedEmail;
  /** Where to redirect after a successful invite acceptance. Default: `${siteUrl}/`. */
  acceptSuccessRedirect?: string;
}

const createTeamSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(64),
});

const updateTeamSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  slug: z.string().min(1).max(64).optional(),
});

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['member', 'admin']),
});

const updateMemberRoleSchema = z.object({
  role: z.enum(['member', 'admin']),
});

const transferSchema = z.object({
  toUserId: z.string().min(1),
});

const teamsPluginAsync: FastifyPluginAsync<TeamsPluginOptions> = async (
  fastify: FastifyInstance,
  options: TeamsPluginOptions,
) => {
  const inviteTtlDays = options.inviteTtlDays ?? 7;

  function requireUser(req: FastifyRequest) {
    if (!req.user) {
      const err: Error & { statusCode?: number } = new Error('Authentication required');
      err.statusCode = 401;
      throw err;
    }
    return req.user;
  }

  // Error handling lives on authPlugin (shared mapUatError); declared as a
  // dependency below so it always runs first. We re-throw and let it map.

  // ---- GET /teams (mine) ----
  fastify.get('/teams', async (req) => {
    const user = requireUser(req);
    const teams = await listMyTeams({ repo: options.repository, userId: user.id });
    return { teams };
  });

  // ---- POST /teams ----
  fastify.post('/teams', async (req, reply) => {
    const user = requireUser(req);
    const parsed = createTeamSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload', issues: parsed.error.issues };
    }
    const team = await createTeam({
      repo: options.repository,
      actorId: user.id,
      name: parsed.data.name,
      slug: parsed.data.slug,
    });
    reply.code(201);
    return { team };
  });

  // ---- GET /teams/:id ----
  fastify.get<{ Params: { id: string } }>('/teams/:id', async (req, reply) => {
    const user = requireUser(req);
    const team = await options.repository.getTeam(req.params.id);
    if (!team) {
      reply.code(404);
      return { error: 'TEAM_NOT_FOUND' };
    }
    const membership = await options.repository.getTeamMember(team.id, user.id);
    if (!membership && user.role !== 'admin') {
      reply.code(403);
      return { error: 'NOT_AUTHORIZED' };
    }
    const members = await listMembers({ repo: options.repository, teamId: team.id });
    return { team, members, membership };
  });

  // ---- PATCH /teams/:id ----
  fastify.patch<{ Params: { id: string } }>('/teams/:id', async (req, reply) => {
    const user = requireUser(req);
    const parsed = updateTeamSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload', issues: parsed.error.issues };
    }
    const patchInput: Parameters<typeof editTeam>[0] = {
      repo: options.repository,
      actorId: user.id,
      teamId: req.params.id,
    };
    if (parsed.data.name !== undefined) patchInput.name = parsed.data.name;
    if (parsed.data.slug !== undefined) patchInput.slug = parsed.data.slug;
    const team = await editTeam(patchInput);
    return { team };
  });

  // ---- DELETE /teams/:id ----
  fastify.delete<{ Params: { id: string } }>('/teams/:id', async (req) => {
    const user = requireUser(req);
    await deleteTeam({
      repo: options.repository,
      actorId: user.id,
      teamId: req.params.id,
    });
    return { ok: true };
  });

  // ---- POST /teams/:id/invites ----
  fastify.post<{ Params: { id: string } }>('/teams/:id/invites', async (req, reply) => {
    const user = requireUser(req);
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload', issues: parsed.error.issues };
    }
    const inviteInput: Parameters<typeof inviteMember>[0] = {
      repo: options.repository,
      actorId: user.id,
      teamId: req.params.id,
      email: parsed.data.email,
      role: parsed.data.role,
      transport: options.email,
      siteName: options.siteName,
      siteUrl: options.siteUrl,
      inviteTtlDays,
    };
    if (options.inviteTemplate) inviteInput.template = options.inviteTemplate;
    const result = await inviteMember(inviteInput);
    reply.code(201);
    return result;
  });

  // ---- GET /teams/invites/accept ----
  fastify.get('/teams/invites/accept', async (req, reply) => {
    const user = requireUser(req);
    const query = z.object({ token: z.string().min(1) }).safeParse(req.query);
    if (!query.success) {
      reply.code(400);
      return { error: 'invalid_token' };
    }
    const member = await acceptInvite({
      repo: options.repository,
      token: query.data.token,
      userId: user.id,
    });
    return { ok: true, member };
  });

  // ---- DELETE /teams/:id/members/:userId ----
  fastify.delete<{ Params: { id: string; userId: string } }>(
    '/teams/:id/members/:userId',
    async (req) => {
      const user = requireUser(req);
      await removeMember({
        repo: options.repository,
        actorId: user.id,
        teamId: req.params.id,
        userId: req.params.userId,
      });
      return { ok: true };
    },
  );

  // ---- PATCH /teams/:id/members/:userId ----
  fastify.patch<{ Params: { id: string; userId: string } }>(
    '/teams/:id/members/:userId',
    async (req, reply) => {
      const user = requireUser(req);
      const parsed = updateMemberRoleSchema.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: 'invalid_payload', issues: parsed.error.issues };
      }
      const member = await updateMemberRole({
        repo: options.repository,
        actorId: user.id,
        teamId: req.params.id,
        userId: req.params.userId,
        role: parsed.data.role,
      });
      return { member };
    },
  );

  // ---- POST /teams/:id/transfer-ownership ----
  fastify.post<{ Params: { id: string } }>(
    '/teams/:id/transfer-ownership',
    async (req, reply) => {
      const user = requireUser(req);
      const parsed = transferSchema.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: 'invalid_payload', issues: parsed.error.issues };
      }
      await transferOwnership({
        repo: options.repository,
        actorId: user.id,
        teamId: req.params.id,
        toUserId: parsed.data.toUserId,
      });
      return { ok: true };
    },
  );
};

export const teamsPlugin = fp(teamsPluginAsync, {
  name: 'users-and-teams-teams',
  fastify: '5.x',
  dependencies: ['users-and-teams-auth'],
});
