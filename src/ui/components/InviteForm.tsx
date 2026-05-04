// InviteForm — add a member to a team by email. Hits POST /teams/:id/members.
// Existing users are added immediately; unknown emails get a magic-link signup.

import { useContext, useState } from 'react';
import { ProviderConfigContext } from '../provider-internal.js';

export interface InviteFormProps {
  teamId: string;
  /** Called after a successful add. Receives the email and the result kind. */
  onAdded?: (email: string, status: 'added' | 'pending_signup') => void;
  className?: string;
}

export function InviteForm({ teamId, onAdded, className }: InviteFormProps) {
  const config = useContext(ProviderConfigContext);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'added' | 'pending_signup' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className={className}
      onSubmit={async (e) => {
        e.preventDefault();
        if (status === 'sending') return;
        setStatus('sending');
        setError(null);

        try {
          const res = await config.fetch(`${config.apiBase}/teams/${teamId}/members`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim() }),
          });
          if (res.status === 201) {
            const data = (await res.json()) as { status: 'added' | 'pending_signup' };
            setStatus(data.status);
            onAdded?.(email.trim(), data.status);
          } else if (res.status === 409) {
            setStatus('error');
            setError('That user is already a member of this team.');
          } else if (res.status === 403) {
            setStatus('error');
            setError("You don't have permission to add members to this team.");
          } else if (res.status === 400) {
            setStatus('error');
            setError('Please enter a valid email address.');
          } else {
            setStatus('error');
            setError('Could not add the member.');
          }
        } catch {
          setStatus('error');
          setError('Network error. Try again.');
        }
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <input
        className="uat-login__input"
        type="email"
        placeholder="teammate@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        aria-label="Member email"
      />
      <button
        className="uat-login__button"
        type="submit"
        disabled={status === 'sending'}
      >
        {status === 'sending' ? 'Adding…' : 'Add member'}
      </button>
      {status === 'added' && (
        <p className="uat-login__success" role="status">
          Added <strong>{email.trim()}</strong> to the team.
        </p>
      )}
      {status === 'pending_signup' && (
        <p className="uat-login__success" role="status">
          Sent a sign-up link to <strong>{email.trim()}</strong>. They'll join as soon as they sign in.
        </p>
      )}
      {status === 'error' && error && (
        <p className="uat-login__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
