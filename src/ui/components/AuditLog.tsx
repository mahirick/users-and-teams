// AuditLog: filterable list of recent audit entries. Filters are pushed to the
// server (`?action=…&actorId=…&targetId=…&limit=…`) so big logs paginate well.

import { useContext, useEffect, useMemo, useState } from 'react';
import { ProviderConfigContext } from '../provider-internal.js';

interface AuditEntryRow {
  id: number;
  actorId: string | null;
  action: string;
  targetId: string | null;
  metadataJson: string | null;
  createdAt: number;
}

export interface AuditLogProps {
  className?: string;
  initialAction?: string;
  initialActorId?: string;
  initialTargetId?: string;
  initialLimit?: number;
  /** Optional preset action choices for the dropdown. */
  actionOptions?: string[];
}

const DEFAULT_ACTIONS = [
  'user.create',
  'user.suspend',
  'user.unsuspend',
  'user.delete',
  'user.role.change',
  'user.display_name.change',
  'team.create',
  'team.delete',
  'team.invite.send',
  'team.invite.accept',
  'team.member.add',
  'team.member.remove',
  'team.member.role.change',
  'team.transfer',
];

export function AuditLog({
  className,
  initialAction = '',
  initialActorId = '',
  initialTargetId = '',
  initialLimit = 100,
  actionOptions = DEFAULT_ACTIONS,
}: AuditLogProps) {
  const config = useContext(ProviderConfigContext);
  const [action, setAction] = useState(initialAction);
  const [actorId, setActorId] = useState(initialActorId);
  const [targetId, setTargetId] = useState(initialTargetId);
  const [limit, setLimit] = useState(initialLimit);
  const [entries, setEntries] = useState<AuditEntryRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (action) p.set('action', action);
    if (actorId.trim()) p.set('actorId', actorId.trim());
    if (targetId.trim()) p.set('targetId', targetId.trim());
    p.set('limit', String(limit));
    return p.toString();
  }, [action, actorId, targetId, limit]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void config
      .fetch(`${config.apiBase}/admin/audit-log?${queryString}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { entries: [] }))
      .then((j: { entries?: AuditEntryRow[] }) => {
        if (!cancelled) setEntries(j.entries ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config, queryString]);

  return (
    <div className={className}>
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <select
          className="uat-login__input"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          aria-label="Filter by action"
          style={{ width: 220 }}
        >
          <option value="">All actions</option>
          {actionOptions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <input
          className="uat-login__input"
          type="search"
          placeholder="Actor id…"
          value={actorId}
          onChange={(e) => setActorId(e.target.value)}
          aria-label="Filter by actor id"
          style={{ width: 200 }}
        />
        <input
          className="uat-login__input"
          type="search"
          placeholder="Target id…"
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          aria-label="Filter by target id"
          style={{ width: 200 }}
        />
        <select
          className="uat-login__input"
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          aria-label="Limit"
          style={{ width: 100 }}
        >
          {[25, 50, 100, 250, 500].map((n) => (
            <option key={n} value={n}>
              Last {n}
            </option>
          ))}
        </select>
        <span style={{ color: 'var(--uat-text-muted)', fontSize: 12 }}>
          {loading ? 'loading…' : `${entries?.length ?? 0} entries`}
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--uat-border-light)' }}>
            <th style={th}>When</th>
            <th style={th}>Action</th>
            <th style={th}>Actor</th>
            <th style={th}>Target</th>
            <th style={th}>Metadata</th>
          </tr>
        </thead>
        <tbody>
          {(entries ?? []).map((e) => (
            <tr key={e.id} style={{ borderBottom: '1px solid var(--uat-border-light)' }}>
              <td style={td}>{new Date(e.createdAt).toLocaleString()}</td>
              <td style={{ ...td, fontFamily: 'var(--uat-font-mono)' }}>{e.action}</td>
              <td style={{ ...td, fontFamily: 'var(--uat-font-mono)', color: 'var(--uat-text-muted)' }}>
                {e.actorId ?? '—'}
              </td>
              <td style={{ ...td, fontFamily: 'var(--uat-font-mono)', color: 'var(--uat-text-muted)' }}>
                {e.targetId ?? '—'}
              </td>
              <td
                style={{
                  ...td,
                  fontFamily: 'var(--uat-font-mono)',
                  color: 'var(--uat-text-muted)',
                  fontSize: 11,
                  maxWidth: 280,
                  overflowWrap: 'anywhere',
                }}
              >
                {e.metadataJson ?? ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {entries && entries.length === 0 && !loading && (
        <p style={{ color: 'var(--uat-text-muted)', marginTop: 16 }}>No matching entries.</p>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '8px 4px',
  textAlign: 'left',
  fontWeight: 600,
  color: 'var(--uat-text-muted)',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.05,
};
const td: React.CSSProperties = { padding: '8px 4px', verticalAlign: 'top' };
