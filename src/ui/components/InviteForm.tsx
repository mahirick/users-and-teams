// InviteForm: send a team invite by email. Issues POST /teams/:id/invites.

import { useContext, useState } from 'react';
import { ProviderConfigContext } from '../provider-internal.js';

export interface InviteFormProps {
  teamId: string;
  /** Called after a successful invite. */
  onSent?: (email: string) => void;
  className?: string;
}

export function InviteForm({ teamId, onSent, className }: InviteFormProps) {
  const config = useContext(ProviderConfigContext);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
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
          const res = await config.fetch(`${config.apiBase}/teams/${teamId}/invites`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim(), role }),
          });
          if (res.status === 201) {
            setStatus('sent');
            onSent?.(email.trim());
          } else if (res.status === 403) {
            setStatus('error');
            setError("You don't have permission to invite to this team.");
          } else if (res.status === 400) {
            setStatus('error');
            setError('Please enter a valid email address.');
          } else {
            setStatus('error');
            setError('Could not send the invite.');
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
        aria-label="Invitee email"
      />
      <select
        className="uat-login__input"
        value={role}
        onChange={(e) => setRole(e.target.value as 'member' | 'admin')}
        aria-label="Role"
      >
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </select>
      <button
        className="uat-login__button"
        type="submit"
        disabled={status === 'sending'}
      >
        {status === 'sending' ? 'Sending…' : 'Send invite'}
      </button>
      {status === 'sent' && (
        <p className="uat-login__success" role="status">
          Invite sent to <strong>{email.trim()}</strong>.
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
