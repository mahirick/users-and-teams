// Landing page after the backend's /auth/verify redirect. Shows a success card
// and auto-redirects to the app, or an error card with a retry link.
//
// The consumer typically renders this on `/auth/verify-result` (route configurable
// via verifySuccessRedirect / verifyErrorRedirect on authPlugin).

import { useEffect } from 'react';

export interface VerifyResultProps {
  status: 'success' | 'error';
  /** When status==='error', the reason code from the URL. */
  reason?: string;
  /** Where to send the user after a successful verify. Default: '/'. */
  redirectTo?: string;
  /** Where the retry button on error sends the user. Default: '/login'. */
  retryHref?: string;
  /** Delay before auto-redirect on success. Default: 2000ms. */
  delayMs?: number;
  /** Override redirect behavior (e.g., for SPA router navigation). */
  onRedirect?: () => void;
  className?: string;
}

export function VerifyResult({
  status,
  reason,
  redirectTo = '/',
  retryHref = '/login',
  delayMs = 2000,
  onRedirect,
  className,
}: VerifyResultProps) {
  useEffect(() => {
    if (status !== 'success') return;
    const t = setTimeout(() => {
      if (onRedirect) onRedirect();
      else if (typeof window !== 'undefined') window.location.assign(redirectTo);
    }, delayMs);
    return () => clearTimeout(t);
  }, [status, delayMs, redirectTo, onRedirect]);

  if (status === 'success') {
    return (
      <div className={cls('uat-verify', className)}>
        <div className="uat-verify__card">
          <h1 className="uat-verify__title">Signed in</h1>
          <p className="uat-verify__message">Redirecting you to the app…</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cls('uat-verify', 'uat-verify--error', className)}>
      <div className="uat-verify__card">
        <h1 className="uat-verify__title">{titleForReason(reason)}</h1>
        <p className="uat-verify__message">{messageForReason(reason)}</p>
        <a className="uat-verify__action" href={retryHref}>
          Request a new one
        </a>
      </div>
    </div>
  );
}

function titleForReason(reason?: string): string {
  switch (reason) {
    case 'expired':
      return 'Link expired';
    case 'already_used':
      return 'Link already used';
    case 'invalid_token':
      return 'Invalid link';
    case 'suspended':
      return 'Account suspended';
    default:
      return 'Something went wrong';
  }
}

function messageForReason(reason?: string): string {
  switch (reason) {
    case 'expired':
      return 'That sign-in link has expired. They are valid for 15 minutes.';
    case 'already_used':
      return 'That sign-in link was already used. Each link works once.';
    case 'invalid_token':
      return "We couldn't verify that sign-in link. Try requesting a new one.";
    case 'suspended':
      return 'Your account has been suspended. Contact an administrator if you think this is in error.';
    default:
      return "We couldn't sign you in. Try requesting a new link.";
  }
}

function cls(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(' ');
}
