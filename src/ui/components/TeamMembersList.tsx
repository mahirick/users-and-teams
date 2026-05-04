// TeamMembersList: shows team members with their role + remove buttons,
// gated client-side based on the viewer's own membership. Admins can remove
// Users; Users can remove themselves (leave). Admins must transfer first —
// surfaced via a "Transfer admin" picker before the leave action.

import { useContext, useEffect, useState } from 'react';
import { ProviderConfigContext } from '../provider-internal.js';
import { useAuth } from '../provider.js';
import { Avatar } from './Avatar.js';

interface MemberRow {
  member: { teamId: string; userId: string; role: 'admin' | 'user'; joinedAt: number };
  user: {
    id: string;
    email: string;
    displayName: string | null;
    avatarColor: string;
    avatarInitials: string;
    avatarUrl: string | null;
  };
}

export interface TeamMembersListProps {
  teamId: string;
  className?: string;
}

export function TeamMembersList({ teamId, className }: TeamMembersListProps) {
  const config = useContext(ProviderConfigContext);
  const { user } = useAuth();
  const [data, setData] = useState<{
    members: MemberRow[];
    membership: MemberRow['member'] | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTo, setTransferTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  async function refresh() {
    const res = await config.fetch(`${config.apiBase}/teams/${teamId}`, {
      credentials: 'include',
    });
    if (res.ok) {
      const json = (await res.json()) as {
        members: MemberRow[];
        membership: MemberRow['member'] | null;
      };
      setData(json);
    } else {
      setData(null);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  if (!data) return <p style={{ color: '#94a3b8' }}>Loading members…</p>;

  const myRole = data.membership?.role ?? null;
  const isMyTeamAdmin = myRole === 'admin';
  const isSystemOwner = user?.role === 'owner';
  const canRemoveOthers = isMyTeamAdmin || isSystemOwner;
  const otherUsers = data.members.filter((m) => m.user.id !== user?.id && m.member.role === 'user');

  async function removeMember(memberUserId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await config.fetch(
        `${config.apiBase}/teams/${teamId}/members/${memberUserId}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { message?: string }).message ?? 'Could not remove member.');
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function transferAndLeave() {
    if (!transferTo) return;
    setBusy(true);
    setError(null);
    try {
      const t = await config.fetch(`${config.apiBase}/teams/${teamId}/transfer-admin`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toUserId: transferTo }),
      });
      if (!t.ok) {
        const body = await t.json().catch(() => ({}));
        setError((body as { message?: string }).message ?? 'Could not transfer admin.');
        return;
      }
      if (user) {
        await removeMember(user.id);
      }
      setTransferOpen(false);
    } finally {
      setBusy(false);
    }
  }

  const q = search.trim().toLowerCase();
  const visibleMembers = q
    ? data.members.filter(
        (m) =>
          m.user.email.toLowerCase().includes(q) ||
          (m.user.displayName ?? '').toLowerCase().includes(q),
      )
    : data.members;

  return (
    <div className={className}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <input
          className="uat-login__input"
          type="search"
          placeholder="Search members…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search members"
          style={{ flex: 1, maxWidth: 320 }}
        />
        <span style={{ color: 'var(--uat-text-muted)', fontSize: 13 }}>
          {visibleMembers.length} of {data.members.length}
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--uat-border-light)' }}>
            <th style={th}>Member</th>
            <th style={th}>Role</th>
            <th style={{ ...th, textAlign: 'right' }}></th>
          </tr>
        </thead>
        <tbody>
          {visibleMembers.map((m) => {
            const isSelf = user?.id === m.user.id;
            const targetIsAdmin = m.member.role === 'admin';
            const display = m.user.displayName ?? m.user.email;
            return (
              <tr key={m.user.id} style={{ borderBottom: '1px solid var(--uat-border-light)' }}>
                <td style={td}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar
                      initials={m.user.avatarInitials}
                      color={m.user.avatarColor}
                      url={m.user.avatarUrl}
                      size="md"
                      label={display}
                    />
                    <div>
                      <strong>{display}</strong>
                      <div style={{ color: '#94a3b8', fontSize: 12 }}>{m.user.email}</div>
                    </div>
                  </div>
                </td>
                <td style={td}>
                  <span className={targetIsAdmin ? 'uat-pill' : ''}>
                    {targetIsAdmin ? 'Admin' : 'User'}
                  </span>
                </td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {isSelf && targetIsAdmin && otherUsers.length > 0 && (
                    <button
                      type="button"
                      className="uat-account__menu-item"
                      style={{ padding: '6px 10px', display: 'inline-block', width: 'auto' }}
                      onClick={() => setTransferOpen((v) => !v)}
                      disabled={busy}
                    >
                      Transfer admin & leave
                    </button>
                  )}
                  {isSelf && !targetIsAdmin && (
                    <button
                      type="button"
                      className="uat-account__menu-item uat-account__menu-item--danger"
                      style={{ padding: '6px 10px', display: 'inline-block', width: 'auto' }}
                      onClick={() => removeMember(m.user.id)}
                      disabled={busy}
                    >
                      Leave team
                    </button>
                  )}
                  {!isSelf && canRemoveOthers && !targetIsAdmin && (
                    <button
                      type="button"
                      className="uat-account__menu-item uat-account__menu-item--danger"
                      style={{ padding: '6px 10px', display: 'inline-block', width: 'auto' }}
                      onClick={() => removeMember(m.user.id)}
                      disabled={busy}
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {transferOpen && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            border: '1px solid var(--uat-border-light)',
            borderRadius: 8,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <span>Transfer admin to:</span>
          <select
            value={transferTo}
            onChange={(e) => setTransferTo(e.target.value)}
            className="uat-login__input"
            style={{ flex: '1 1 200px' }}
            aria-label="New admin"
          >
            <option value="">Choose member…</option>
            {otherUsers.map((m) => (
              <option key={m.user.id} value={m.user.id}>
                {m.user.displayName ?? m.user.email}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="uat-login__button"
            style={{ width: 'auto', padding: '8px 14px' }}
            onClick={() => transferAndLeave()}
            disabled={busy || !transferTo}
          >
            Transfer & leave
          </button>
        </div>
      )}
      {error && (
        <p className="uat-login__error" role="alert" style={{ marginTop: 8 }}>
          {error}
        </p>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '8px 4px',
  textAlign: 'left',
  fontWeight: 600,
  color: '#94a3b8',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: 0.05,
};
const td: React.CSSProperties = { padding: '12px 4px', verticalAlign: 'top' };
