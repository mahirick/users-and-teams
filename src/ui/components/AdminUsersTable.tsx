// AdminUsersTable: paginated user list with search + per-row actions
// (suspend / unsuspend / delete / change role).

import { useContext, useEffect, useState } from 'react';
import { ProviderConfigContext } from '../provider-internal.js';
import { useAuth } from '../provider.js';

interface UserRow {
  id: string;
  email: string;
  displayName: string | null;
  role: 'user' | 'admin';
  status: 'active' | 'suspended' | 'deleted';
  createdAt: number;
  lastSeenAt: number | null;
}

interface ListResponse {
  users: UserRow[];
  total: number;
}

export interface AdminUsersTableProps {
  className?: string;
  pageSize?: number;
  /** Called when an admin clicks a user row. */
  onSelect?: (user: UserRow) => void;
}

export function AdminUsersTable({ className, pageSize = 25, onSelect }: AdminUsersTableProps) {
  const config = useContext(ProviderConfigContext);
  const { user } = useAuth();
  const [data, setData] = useState<ListResponse | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    const res = await config.fetch(`${config.apiBase}/admin/users?${params}`, {
      credentials: 'include',
    });
    if (res.ok) {
      setData((await res.json()) as ListResponse);
    } else {
      setData(null);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, page]);

  async function call(path: string, init: RequestInit) {
    setBusy(true);
    try {
      await config.fetch(`${config.apiBase}${path}`, {
        credentials: 'include',
        ...init,
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <p style={{ color: '#94a3b8' }}>Loading users…</p>;

  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));

  return (
    <div className={className}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input
          className="uat-login__input"
          type="search"
          placeholder="Search email or name…"
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
          style={{ flex: 1, maxWidth: 320 }}
          aria-label="Search users"
        />
        <span style={{ color: '#94a3b8', fontSize: 13 }}>
          {data.total} user{data.total === 1 ? '' : 's'}
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--uat-border-light)' }}>
            <th style={th}>User</th>
            <th style={th}>Role</th>
            <th style={th}>Status</th>
            <th style={{ ...th, textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {data.users.map((u) => {
            const isSelf = user?.id === u.id;
            return (
              <tr
                key={u.id}
                style={{
                  borderBottom: '1px solid var(--uat-border-light)',
                  cursor: onSelect ? 'pointer' : undefined,
                }}
                onClick={() => onSelect?.(u)}
              >
                <td style={td}>
                  <strong>{u.displayName ?? u.email}</strong>
                  <br />
                  <span style={{ color: '#94a3b8', fontSize: 12 }}>{u.email}</span>
                </td>
                <td style={td}>
                  <Badge color={u.role === 'admin' ? '#06b6d4' : '#94a3b8'}>{u.role}</Badge>
                </td>
                <td style={td}>
                  <Badge
                    color={
                      u.status === 'active'
                        ? '#34d399'
                        : u.status === 'suspended'
                          ? '#f87171'
                          : '#94a3b8'
                    }
                  >
                    {u.status}
                  </Badge>
                </td>
                <td
                  style={{ ...td, textAlign: 'right' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {!isSelf && u.status === 'active' && (
                    <button
                      type="button"
                      className="uat-account__menu-item"
                      style={pill}
                      disabled={busy}
                      onClick={() =>
                        call(`/admin/users/${u.id}/suspend`, { method: 'POST' })
                      }
                    >
                      Suspend
                    </button>
                  )}
                  {!isSelf && u.status === 'suspended' && (
                    <button
                      type="button"
                      className="uat-account__menu-item"
                      style={pill}
                      disabled={busy}
                      onClick={() =>
                        call(`/admin/users/${u.id}/unsuspend`, { method: 'POST' })
                      }
                    >
                      Unsuspend
                    </button>
                  )}
                  {!isSelf && (
                    <button
                      type="button"
                      className="uat-account__menu-item uat-account__menu-item--danger"
                      style={pill}
                      disabled={busy}
                      onClick={() => {
                        if (confirm(`Delete ${u.email}? This cannot be undone.`)) {
                          void call(`/admin/users/${u.id}`, { method: 'DELETE' });
                        }
                      }}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16 }}>
          <button
            type="button"
            className="uat-login__button"
            style={{ padding: '6px 12px' }}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            Prev
          </button>
          <span style={{ color: '#94a3b8', fontSize: 13 }}>
            Page {page} / {totalPages}
          </span>
          <button
            type="button"
            className="uat-login__button"
            style={{ padding: '6px 12px' }}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            Next
          </button>
        </div>
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
const pill: React.CSSProperties = {
  padding: '6px 10px',
  display: 'inline-block',
  width: 'auto',
  marginLeft: 4,
};

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${color}`,
        color,
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 600,
        textTransform: 'lowercase',
      }}
    >
      {children}
    </span>
  );
}
