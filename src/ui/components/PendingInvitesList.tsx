// PendingInvitesList — visible to a team's Admin (and system Owners). Shows
// each unconsumed, unexpired invite emailed to a not-yet-registered user, with
// "Resend" and "Cancel" buttons. The Admin uses this to chase people who
// haven't signed up yet.
//
// Hits:
//   GET    /teams/:id/pending-invites
//   POST   /teams/:id/pending-invites/:tokenHash/resend
//   DELETE /teams/:id/pending-invites/:tokenHash

import { useContext, useEffect, useState } from 'react';
import { ProviderConfigContext } from '../provider-internal.js';

export interface PendingInvitesListProps {
  teamId: string;
  className?: string;
}

interface PendingInvite {
  tokenHash: string;
  email: string;
  createdAt: number;
  expiresAt: number;
}

export function PendingInvitesList({ teamId, className }: PendingInvitesListProps) {
  const config = useContext(ProviderConfigContext);
  const [invites, setInvites] = useState<PendingInvite[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // tokenHash being acted on
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    const res = await config.fetch(`${config.apiBase}/teams/${teamId}/pending-invites`, {
      credentials: 'include',
    });
    if (res.ok) {
      const data = (await res.json()) as { invites: PendingInvite[] };
      setInvites(data.invites);
    } else if (res.status === 403) {
      setInvites([]); // not an admin — show empty state silently
    } else {
      setError('Could not load pending invites.');
      setInvites([]);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  if (!invites) return null;
  if (invites.length === 0 && !error) return null;

  async function resend(tokenHash: string) {
    setBusy(tokenHash);
    setError(null);
    try {
      const res = await config.fetch(
        `${config.apiBase}/teams/${teamId}/pending-invites/${tokenHash}/resend`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) setError('Could not resend the invite.');
      else await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function cancel(tokenHash: string) {
    setBusy(tokenHash);
    setError(null);
    try {
      const res = await config.fetch(
        `${config.apiBase}/teams/${teamId}/pending-invites/${tokenHash}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) setError('Could not cancel the invite.');
      else await refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={className}>
      <h3
        style={{
          margin: '0 0 8px',
          fontSize: 13,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.06,
          color: 'var(--uat-text-muted)',
        }}
      >
        Pending invites
      </h3>
      {error && (
        <p className="uat-login__error" role="alert" style={{ marginBottom: 8 }}>
          {error}
        </p>
      )}
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {invites.map((inv) => (
          <li
            key={inv.tokenHash}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '8px 12px',
              border: '1px solid var(--uat-border-light)',
              borderRadius: 8,
              background: 'var(--uat-bg-secondary)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: 'var(--uat-font-mono)',
                  fontSize: 13,
                  color: 'var(--uat-text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {inv.email}
              </div>
              <div style={{ fontSize: 11, color: 'var(--uat-text-muted)' }}>
                invited {relativeTime(inv.createdAt)} · expires {relativeTime(inv.expiresAt)}
              </div>
            </div>
            <button
              type="button"
              className="uat-account__menu-item"
              style={{ padding: '4px 10px', display: 'inline-block', width: 'auto', fontSize: 12 }}
              disabled={busy === inv.tokenHash}
              onClick={() => resend(inv.tokenHash)}
            >
              Resend
            </button>
            <button
              type="button"
              className="uat-account__menu-item uat-account__menu-item--danger"
              style={{ padding: '4px 10px', display: 'inline-block', width: 'auto', fontSize: 12 }}
              disabled={busy === inv.tokenHash}
              onClick={() => cancel(inv.tokenHash)}
            >
              Cancel
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function relativeTime(ts: number): string {
  const now = Date.now();
  const diff = ts - now;
  const abs = Math.abs(diff);
  const s = Math.round(abs / 1000);
  const m = Math.round(s / 60);
  const h = Math.round(m / 60);
  const d = Math.round(h / 24);
  let phrase: string;
  if (s < 60) phrase = 'just now';
  else if (m < 60) phrase = `${m} min`;
  else if (h < 24) phrase = `${h} hr`;
  else phrase = `${d} day${d === 1 ? '' : 's'}`;
  if (s < 60) return phrase;
  return diff < 0 ? `${phrase} ago` : `in ${phrase}`;
}
