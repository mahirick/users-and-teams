// AuditLog: filterable list of recent audit entries.

import { useContext, useEffect, useState } from 'react';
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
  /** Filter by action prefix or substring. */
  initialFilter?: string;
  limit?: number;
}

export function AuditLog({ className, initialFilter = '', limit = 100 }: AuditLogProps) {
  const config = useContext(ProviderConfigContext);
  const [filter, setFilter] = useState(initialFilter);
  const [entries, setEntries] = useState<AuditEntryRow[] | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    void config
      .fetch(`${config.apiBase}/admin/audit-log?${params}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { entries: [] }))
      .then((j: { entries?: AuditEntryRow[] }) => setEntries(j.entries ?? []));
  }, [config, limit]);

  if (!entries) return <p style={{ color: '#94a3b8' }}>Loading audit log…</p>;

  const filtered = filter
    ? entries.filter(
        (e) =>
          e.action.toLowerCase().includes(filter.toLowerCase()) ||
          (e.actorId ?? '').includes(filter) ||
          (e.targetId ?? '').includes(filter),
      )
    : entries;

  return (
    <div className={className}>
      <input
        className="uat-login__input"
        type="search"
        placeholder="Filter by action / actor / target…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{ marginBottom: 12, maxWidth: 320 }}
        aria-label="Filter audit"
      />
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
          {filtered.map((e) => (
            <tr key={e.id} style={{ borderBottom: '1px solid var(--uat-border-light)' }}>
              <td style={td}>{new Date(e.createdAt).toLocaleString()}</td>
              <td style={{ ...td, fontFamily: 'var(--uat-font-mono)' }}>{e.action}</td>
              <td style={{ ...td, fontFamily: 'var(--uat-font-mono)', color: '#94a3b8' }}>
                {e.actorId ?? '—'}
              </td>
              <td style={{ ...td, fontFamily: 'var(--uat-font-mono)', color: '#94a3b8' }}>
                {e.targetId ?? '—'}
              </td>
              <td
                style={{
                  ...td,
                  fontFamily: 'var(--uat-font-mono)',
                  color: '#94a3b8',
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
      {filtered.length === 0 && (
        <p style={{ color: '#94a3b8', marginTop: 16 }}>No matching entries.</p>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '8px 4px',
  textAlign: 'left',
  fontWeight: 600,
  color: '#94a3b8',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.05,
};
const td: React.CSSProperties = { padding: '8px 4px', verticalAlign: 'top' };
