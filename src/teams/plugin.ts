// Fastify plugin for /teams/* routes. Each route checks authentication via
// request.user (populated by authPlugin's onRequest hook), then delegates to
// the operations module which enforces team-level permissions.

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import { NotAuthorizedError, TeamNotFoundError } from '../core/errors.js';
import { mapUatError } from '../core/error-handler.js';
import type { AvatarStore } from '../avatars/types.js';
import { decodeAvatarDataUrl } from '../auth/plugin.js';
import { canAddMember } from './permissions.js';
import type { Repository } from '../core/repository.js';
import type { EmailTransport } from '../email/types.js';
import { addedToTeamEmail, signupAddedToTeamEmail } from '../email/templates.js';
import {
  addMember,
  cancelPendingInvite,
  createTeam,
  deleteTeam,
  editTeam,
  listMembers,
  listMyTeams,
  listPendingInvites,
  removeMember,
  resendPendingInvite,
  transferAdmin,
} from './operations.js';

export interface TeamsPluginOptions {
  repository: Repository;
  email: EmailTransport;
  siteUrl: string;
  siteName: string;
  inviteTtlDays?: number;
  /** Override the "you were added to a team" email (existing user). */
  addedTemplate?: typeof addedToTeamEmail;
  /** Override the "you were added — sign up to see it" email (unknown email). */
  signupAddedTemplate?: typeof signupAddedToTeamEmail;
  /** Avatar storage. Pass to enable POST/DELETE /teams/:id/avatar. */
  avatarStore?: AvatarStore;
}

const teamAvatarSchema = z.object({
  data: z.string().min(1),
});

const createTeamSchema = z.object({
  name: z.string().min(1).max(120),
});

const updateTeamSchema = z.object({
  name: z.string().min(1).max(120),
});

const addMembersSchema = z.object({
  emails: z.array(z.string().trim().min(1)).min(1).max(50),
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
    if (!membership && user.role !== 'owner') {
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
    const team = await editTeam({
      repo: options.repository,
      actorId: user.id,
      teamId: req.params.id,
      name: parsed.data.name,
    });
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

  // ---- POST /teams/:id/members ----
  // Body: { emails: string[] } — one or more emails. Each is processed
  // independently and reported in `results` (200/207 on the request even when
  // individual entries fail; check `results[i].status`).
  fastify.post<{ Params: { id: string } }>('/teams/:id/members', async (req, reply) => {
    const user = requireUser(req);
    const parsed = addMembersSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload', issues: parsed.error.issues };
    }
    const seen = new Set<string>();
    const queue: string[] = [];
    for (const raw of parsed.data.emails) {
      const e = raw.trim().toLowerCase();
      if (!e || seen.has(e)) continue;
      seen.add(e);
      queue.push(e);
    }

    type EntryResult =
      | { email: string; status: 'added'; userId: string }
      | { email: string; status: 'pending_signup' }
      | { email: string; status: 'error'; code: string; message: string };

    const results: EntryResult[] = [];
    for (const email of queue) {
      try {
        const r = await addMember({
          repo: options.repository,
          actorId: user.id,
          teamId: req.params.id,
          email,
          transport: options.email,
          siteName: options.siteName,
          siteUrl: options.siteUrl,
          inviteTtlDays,
          ...(options.addedTemplate ? { addedTemplate: options.addedTemplate } : {}),
          ...(options.signupAddedTemplate ? { signupAddedTemplate: options.signupAddedTemplate } : {}),
        });
        if (r.status === 'added') {
          results.push({ email, status: 'added', userId: r.userId });
        } else {
          results.push({ email, status: 'pending_signup' });
        }
      } catch (err) {
        // Stop early on auth failures — they're per-actor, not per-email.
        if (err instanceof NotAuthorizedError) throw err;
        const mapped = mapUatError(err);
        if (mapped) {
          results.push({
            email,
            status: 'error',
            code: mapped.body.error,
            message: mapped.body.message,
          });
        } else {
          results.push({
            email,
            status: 'error',
            code: 'unknown',
            message: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
    }

    reply.code(207);
    return { results };
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

  // ---- GET /teams/:id/pending-invites ----
  fastify.get<{ Params: { id: string } }>(
    '/teams/:id/pending-invites',
    async (req) => {
      const user = requireUser(req);
      const invites = await listPendingInvites({
        repo: options.repository,
        actorId: user.id,
        teamId: req.params.id,
      });
      // Don't leak inviter ids beyond what the UI needs; map to a slim shape.
      return {
        invites: invites.map((i) => ({
          tokenHash: i.tokenHash,
          email: i.email,
          createdAt: i.createdAt,
          expiresAt: i.expiresAt,
        })),
      };
    },
  );

  // ---- DELETE /teams/:id/pending-invites/:tokenHash ----
  fastify.delete<{ Params: { id: string; tokenHash: string } }>(
    '/teams/:id/pending-invites/:tokenHash',
    async (req) => {
      const user = requireUser(req);
      await cancelPendingInvite({
        repo: options.repository,
        actorId: user.id,
        teamId: req.params.id,
        tokenHash: req.params.tokenHash,
      });
      return { ok: true };
    },
  );

  // ---- POST /teams/:id/pending-invites/:tokenHash/resend ----
  fastify.post<{ Params: { id: string; tokenHash: string } }>(
    '/teams/:id/pending-invites/:tokenHash/resend',
    async (req) => {
      const user = requireUser(req);
      await resendPendingInvite({
        repo: options.repository,
        actorId: user.id,
        teamId: req.params.id,
        tokenHash: req.params.tokenHash,
        transport: options.email,
        siteName: options.siteName,
        siteUrl: options.siteUrl,
        inviteTtlDays,
        ...(options.signupAddedTemplate ? { signupAddedTemplate: options.signupAddedTemplate } : {}),
      });
      return { ok: true };
    },
  );

  // ---- POST /teams/:id/avatar ----  (Admin uploads team photo)
  fastify.post<{ Params: { id: string } }>('/teams/:id/avatar', async (req, reply) => {
    const user = requireUser(req);
    if (!options.avatarStore) {
      reply.code(501);
      return { error: 'AVATAR_STORE_NOT_CONFIGURED' };
    }
    const team = await options.repository.getTeam(req.params.id);
    if (!team) throw new TeamNotFoundError();
    if (!canAddMember(team, user)) {
      reply.code(403);
      return { error: 'NOT_AUTHORIZED' };
    }
    const parsed = teamAvatarSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload' };
    }
    const decoded = decodeAvatarDataUrl(parsed.data.data);
    if (!decoded) {
      reply.code(400);
      return { error: 'invalid_image' };
    }
    const result = await options.avatarStore.put({
      key: `teams/${team.id}`,
      bytes: decoded.bytes,
      contentType: decoded.contentType,
    });
    const updated = await options.repository.updateTeam(team.id, {
      avatarUrl: result.url,
    });
    return { team: updated };
  });

  // ---- DELETE /teams/:id/avatar ----
  fastify.delete<{ Params: { id: string } }>('/teams/:id/avatar', async (req, reply) => {
    const user = requireUser(req);
    const team = await options.repository.getTeam(req.params.id);
    if (!team) throw new TeamNotFoundError();
    if (!canAddMember(team, user)) {
      reply.code(403);
      return { error: 'NOT_AUTHORIZED' };
    }
    if (options.avatarStore) {
      await options.avatarStore.delete(`teams/${team.id}`);
    }
    const updated = await options.repository.updateTeam(team.id, { avatarUrl: null });
    return { team: updated };
  });

  // ---- POST /teams/:id/transfer-admin ----
  fastify.post<{ Params: { id: string } }>(
    '/teams/:id/transfer-admin',
    async (req, reply) => {
      const user = requireUser(req);
      const parsed = transferSchema.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: 'invalid_payload', issues: parsed.error.issues };
      }
      await transferAdmin({
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
