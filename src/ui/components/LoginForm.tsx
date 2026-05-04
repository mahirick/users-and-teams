// Magic-link login form. Posts the email to /auth/request-link and shows a
// confirmation. Fully styled via .uat-login* classes; pass className to merge
// custom classes.

import { useId, useState, type FormEvent } from 'react';
import { useAuth } from '../provider.js';

export interface LoginFormProps {
  /** Shown in the heading: "Sign in to {siteName}". Defaults to "your account". */
  siteName?: string;
  /** Extra classes merged onto the root .uat-login element. */
  className?: string;
  /** Called after a successful submission (e.g., to navigate or show a toast). */
  onSuccess?: (email: string) => void;
}

export function LoginForm({ siteName = 'your account', className, onSuccess }: LoginFormProps) {
  const { requestLink } = useAuth();
  const inputId = useId();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === 'sending') return;
    setStatus('sending');
    setError(null);

    const result = await requestLink(email.trim());
    if (result.ok) {
      setStatus('sent');
      onSuccess?.(email);
    } else {
      setStatus('error');
      setError(messageFor(result.error));
    }
  }

  return (
    <form className={cls('uat-login', className)} onSubmit={onSubmit} noValidate>
      <h1 className="uat-login__title">Sign in to {siteName}</h1>
      <p className="uat-login__subtitle">We'll email you a one-time link.</p>

      <label htmlFor={inputId} style={{ position: 'absolute', left: '-9999px' }}>
        Email
      </label>
      <input
        id={inputId}
        className="uat-login__input"
        type="email"
        placeholder="you@example.com"
        autoComplete="email"
        aria-label="Email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={status === 'sending' || status === 'sent'}
      />

      <button
        className="uat-login__button"
        type="submit"
        disabled={status === 'sending' || status === 'sent' || email.length === 0}
      >
        {status === 'sending' ? 'Sending…' : 'Send magic link'}
      </button>

      {status === 'sent' && (
        <p className="uat-login__success" role="status">
          Check your inbox at <strong>{email}</strong>. The link is valid for 15 minutes.
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

function messageFor(code?: string): string {
  switch (code) {
    case 'invalid_email':
      return "Please enter a valid email address.";
    case 'rate_limited':
      return 'Too many requests. Please wait a few minutes and try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

function cls(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(' ');
}
