// TeamMembersList: shows team members with their role + remove buttons,
// gated client-side based on the viewer's own membership.

import { useContext, useEffect, useState } from 'react';
import { ProviderConfigContext } from '../provider-internal.js';
import { useAuth } from '../provider.js';

interface MemberRow {
  member: { teamId: string; userId: string; role: 'owner' | 'admin' | 'member'; joinedAt: number };
  user: { id: string; email: string; displayName: string | null };
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
  const canChangeRole = myRole === 'owner' || user?.role === 'admin';
  const canRemoveOthers =
    myRole === 'owner' || myRole === 'admin' || user?.role === 'admin';

  async function setRole(memberUserId: string, role: 'member' | 'admin') {
    setBusy(true);
    try {
      await config.fetch(`${config.apiBase}/teams/${teamId}/members/${memberUserId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(memberUserId: string) {
    setBusy(true);
    try {
      await config.fetch(`${config.apiBase}/teams/${teamId}/members/${memberUserId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--uat-border-light)' }}>
            <th style={th}>Member</th>
            <th style={th}>Role</th>
            <th style={{ ...th, textAlign: 'right' }}></th>
          </tr>
        </thead>
        <tbody>
          {data.members.map((m) => {
            const isSelf = user?.id === m.user.id;
            const targetIsOwner = m.member.role === 'owner';
            return (
              <tr key={m.user.id} style={{ borderBottom: '1px solid var(--uat-border-light)' }}>
                <td style={td}>
                  <strong>{m.user.displayName ?? m.user.email}</strong>
                  <br />
                  <span style={{ color: '#94a3b8', fontSize: 12 }}>{m.user.email}</span>
                </td>
                <td style={td}>
                  {canChangeRole && !targetIsOwner ? (
                    <select
                      value={m.member.role}
                      onChange={(e) =>
                        setRole(m.user.id, e.target.value as 'member' | 'admin')
                      }
                      disabled={busy}
                      aria-label={`Role for ${m.user.email}`}
                    >
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                    </select>
                  ) : (
                    <span>{m.member.role}</span>
                  )}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {canRemoveOthers && !targetIsOwner && !isSelf && (
                    <button
                      type="button"
                      className="uat-account__menu-item uat-account__menu-item--danger"
                      style={{ padding: '6px 10px', display: 'inline-block', width: 'auto' }}
                      onClick={() => remove(m.user.id)}
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
    </div>
  );
}

const th: React.CSSProperties = { padding: '8px 4px', textAlign: 'left', fontWeight: 600, color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.05 };
const td: React.CSSProperties = { padding: '12px 4px', verticalAlign: 'top' };
