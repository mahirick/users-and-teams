// InviteForm — add one or more members to a team by email. Hits
// POST /teams/:id/members with { emails: string[] }.
//
// Accepts a single email or a list separated by `;`, `,`, newlines, or
// whitespace. Each entry is validated client-side; the server returns a
// per-entry result so partial successes are visible.

import { useContext, useMemo, useState } from 'react';
import { ProviderConfigContext } from '../provider-internal.js';

export interface InviteFormProps {
  teamId: string;
  /** Called after a successful submit with the per-entry result list. */
  onSubmitted?: (results: ServerResult[]) => void;
  className?: string;
}

interface ParsedList {
  valid: string[];
  invalid: string[];
}

type ServerResult =
  | { email: string; status: 'added'; userId: string }
  | { email: string; status: 'pending_signup' }
  | { email: string; status: 'error'; code: string; message: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseList(raw: string): ParsedList {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[;,\s]+/)) {
    const trimmed = part.trim().toLowerCase();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    if (EMAIL_RE.test(trimmed)) valid.push(trimmed);
    else invalid.push(trimmed);
  }
  return { valid, invalid };
}

function summarize(results: ServerResult[]): string {
  const added = results.filter((r) => r.status === 'added').length;
  const pending = results.filter((r) => r.status === 'pending_signup').length;
  const errored = results.filter((r) => r.status === 'error').length;
  const parts: string[] = [];
  if (added) parts.push(`added ${added}`);
  if (pending) parts.push(`sent ${pending} signup link${pending === 1 ? '' : 's'}`);
  if (errored) parts.push(`${errored} skipped`);
  return parts.length ? parts.join(', ') : 'no changes';
}

export function InviteForm({ teamId, onSubmitted, className }: InviteFormProps) {
  const config = useContext(ProviderConfigContext);
  const [raw, setRaw] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [serverResults, setServerResults] = useState<ServerResult[] | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const parsed = useMemo(() => parseList(raw), [raw]);

  return (
    <form
      className={className}
      onSubmit={async (e) => {
        e.preventDefault();
        if (submitting) return;
        if (parsed.valid.length === 0) return;

        setSubmitting(true);
        setRequestError(null);
        setServerResults(null);

        try {
          const res = await config.fetch(`${config.apiBase}/teams/${teamId}/members`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emails: parsed.valid }),
          });
          if (res.status === 207 || res.status === 200 || res.status === 201) {
            const data = (await res.json()) as { results: ServerResult[] };
            setServerResults(data.results);
            onSubmitted?.(data.results);
            // Clear the input on a clean run (no errors)
            if (!data.results.some((r) => r.status === 'error')) setRaw('');
          } else if (res.status === 403) {
            setRequestError("You don't have permission to add members to this team.");
          } else if (res.status === 400) {
            setRequestError('The server rejected the email list.');
          } else {
            setRequestError('Could not add members.');
          }
        } catch {
          setRequestError('Network error. Try again.');
        } finally {
          setSubmitting(false);
        }
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <textarea
        className="uat-login__input"
        placeholder={'teammate@example.com; another@example.com\nseparate with ; , newlines, or spaces'}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={3}
        aria-label="Member emails"
        style={{ resize: 'vertical', minHeight: 60, fontFamily: 'inherit' }}
      />

      {(parsed.valid.length > 0 || parsed.invalid.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {parsed.valid.map((e) => (
            <span key={`v-${e}`} className="uat-pill" style={pillOk}>
              {e}
            </span>
          ))}
          {parsed.invalid.map((e) => (
            <span key={`i-${e}`} className="uat-pill" style={pillBad}>
              {e}
            </span>
          ))}
        </div>
      )}

      <button
        className="uat-login__button"
        type="submit"
        disabled={submitting || parsed.valid.length === 0}
      >
        {submitting
          ? 'Adding…'
          : parsed.valid.length > 1
            ? `Add ${parsed.valid.length} members`
            : 'Add member'}
      </button>

      {parsed.invalid.length > 0 && !submitting && (
        <p className="uat-login__error" role="alert">
          {parsed.invalid.length === 1 ? "That doesn't look like a valid email." : "Some entries don't look like valid emails."}
        </p>
      )}

      {requestError && (
        <p className="uat-login__error" role="alert">{requestError}</p>
      )}

      {serverResults && serverResults.length > 0 && (
        <div
          style={{
            border: '1px solid var(--uat-border-light)',
            borderRadius: 8,
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <p className="uat-login__success" role="status" style={{ margin: 0 }}>
            {summarize(serverResults)}.
          </p>
          {serverResults.map((r) => (
            <div
              key={r.email}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 12,
                color: '#94a3b8',
              }}
            >
              <span style={{ fontFamily: 'var(--uat-font-mono)' }}>{r.email}</span>
              <span style={r.status === 'error' ? { color: 'var(--uat-error)' } : undefined}>
                {r.status === 'added' && 'added'}
                {r.status === 'pending_signup' && 'signup link sent'}
                {r.status === 'error' && r.message}
              </span>
            </div>
          ))}
        </div>
      )}
    </form>
  );
}

const pillOk: React.CSSProperties = {};
const pillBad: React.CSSProperties = {
  background: 'rgba(248, 113, 113, 0.12)',
  color: 'var(--uat-error)',
  border: '1px solid rgba(248, 113, 113, 0.32)',
};
