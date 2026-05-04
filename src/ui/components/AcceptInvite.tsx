// AcceptInvite: hits /teams/invites/accept?token=... and shows the result.
// Consumer mounts this on /invites/accept (or wherever the invite email URL points).

import { useContext, useEffect, useState } from 'react';
import { ProviderConfigContext } from '../provider-internal.js';
import { useAuth } from '../provider.js';

export interface AcceptInviteProps {
  /** The invite token from the URL. */
  token: string;
  /** Where to send the user after accepting. Default: '/'. */
  redirectTo?: string;
  /** Where to send the user when they need to sign in first. Default: '/login'. */
  loginHref?: string;
  className?: string;
}

type State =
  | { phase: 'loading' }
  | { phase: 'unauthenticated' }
  | { phase: 'success'; teamId: string }
  | { phase: 'error'; reason: string };

export function AcceptInvite({
  token,
  redirectTo = '/',
  loginHref = '/login',
  className,
}: AcceptInviteProps) {
  const config = useContext(ProviderConfigContext);
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setState({ phase: 'unauthenticated' });
      return;
    }
    (async () => {
      try {
        const res = await config.fetch(
          `${config.apiBase}/teams/invites/accept?token=${encodeURIComponent(token)}`,
          { credentials: 'include' },
        );
        if (res.status === 200) {
          const json = (await res.json()) as { member: { teamId: string } };
          setState({ phase: 'success', teamId: json.member.teamId });
        } else {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          setState({ phase: 'error', reason: json.error ?? 'unknown' });
        }
      } catch {
        setState({ phase: 'error', reason: 'network' });
      }
    })();
  }, [authLoading, user, token, config]);

  return (
    <div className={cls('uat-verify', className, state.phase === 'error' ? 'uat-verify--error' : null)}>
      <div className="uat-verify__card">
        {state.phase === 'loading' && <p className="uat-verify__message">Accepting invite…</p>}

        {state.phase === 'unauthenticated' && (
          <>
            <h1 className="uat-verify__title">Sign in to accept</h1>
            <p className="uat-verify__message">
              You need to sign in with the email this invite was sent to before accepting.
            </p>
            <a
              className="uat-verify__action"
              href={`${loginHref}?next=${encodeURIComponent(`/invites/accept?token=${token}`)}`}
            >
              Sign in
            </a>
          </>
        )}

        {state.phase === 'success' && (
          <>
            <h1 className="uat-verify__title">You're in</h1>
            <p className="uat-verify__message">Welcome to the team.</p>
            <a className="uat-verify__action" href={redirectTo}>
              Go to the app
            </a>
          </>
        )}

        {state.phase === 'error' && (
          <>
            <h1 className="uat-verify__title">{titleForReason(state.reason)}</h1>
            <p className="uat-verify__message">{messageForReason(state.reason)}</p>
            <a className="uat-verify__action" href={redirectTo}>
              Continue
            </a>
          </>
        )}
      </div>
    </div>
  );
}

function titleForReason(reason: string): string {
  switch (reason) {
    case 'TOKEN_EXPIRED':
      return 'Invite expired';
    case 'TOKEN_ALREADY_CONSUMED':
      return 'Invite already used';
    case 'INVALID_TOKEN':
      return 'Invalid invite';
    case 'NOT_AUTHORIZED':
      return 'Wrong account';
    default:
      return 'Could not accept invite';
  }
}

function messageForReason(reason: string): string {
  switch (reason) {
    case 'TOKEN_EXPIRED':
      return 'This invite is past its 7-day expiry. Ask the team to send a new one.';
    case 'TOKEN_ALREADY_CONSUMED':
      return 'This invite was already used. If you missed it, ask for a new one.';
    case 'INVALID_TOKEN':
      return "We couldn't find that invite. The link may have been mistyped.";
    case 'NOT_AUTHORIZED':
      return 'This invite was sent to a different email than the one you signed in with.';
    default:
      return 'Something went wrong on our side. Try again later.';
  }
}

function cls(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(' ');
}
