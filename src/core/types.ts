// Core domain types. Pure data shapes, no behavior.
// These are the wire format for all package-internal operations.

export type Role = 'user' | 'admin';
export type UserStatus = 'active' | 'suspended' | 'deleted';
export type MemberRole = 'owner' | 'admin' | 'member';

export interface User {
  id: string;            // UUID v7 (sortable by creation time)
  email: string;         // normalized lowercase
  displayName: string | null;
  role: Role;
  status: UserStatus;
  createdAt: number;     // epoch ms
  lastSeenAt: number | null;
}

export interface Session {
  tokenHash: string;     // sha256(cookie token)
  userId: string;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number;
  ip: string | null;
  userAgent: string | null;
}

export interface MagicLink {
  tokenHash: string;     // sha256(magic link token)
  email: string;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: number;
}

export interface TeamMember {
  teamId: string;
  userId: string;
  role: MemberRole;
  joinedAt: number;
}

export interface TeamInvite {
  tokenHash: string;
  teamId: string;
  inviterId: string;
  email: string;
  role: MemberRole;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
}

export interface AuditEntry {
  id: number;
  actorId: string | null;
  action: string;
  targetId: string | null;
  metadataJson: string | null;
  createdAt: number;
}

// Convenience: a user with the teams they belong to (returned by some routes).
export interface UserWithTeams extends User {
  teams: Array<{ team: Team; role: MemberRole }>;
}
