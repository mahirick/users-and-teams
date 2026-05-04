// Account menu shown in app header. Renders a "Sign in" link if no user; once
// signed in, shows an avatar that opens a dropdown with profile + actions.

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../provider.js';

export interface AccountMenuProps {
  /** Where to send anonymous visitors when they click "Sign in". Default: /login */
  signInHref?: string;
  /** Slot for additional menu items (e.g., "My Teams", "Settings"). Rendered above the divider. */
  extraItems?: React.ReactNode;
  /** Extra classes merged onto the root element. */
  className?: string;
}

export function AccountMenu({
  signInHref = '/login',
  extraItems,
  className,
}: AccountMenuProps) {
  const { user, loading, logout, logoutAll } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (loading) return null;

  if (!user) {
    return (
      <a className={cls('uat-account__signin', className)} href={signInHref}>
        Sign in
      </a>
    );
  }

  const display = user.displayName ?? user.email;
  const initial = (user.displayName ?? user.email).charAt(0).toUpperCase();

  return (
    <div className={cls('uat-account', className)} ref={ref}>
      <button
        type="button"
        className="uat-account__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="uat-account__avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="uat-account__name">{display}</span>
      </button>

      {open && (
        <div className="uat-account__menu" role="menu">
          <div className="uat-account__menu-header">
            <p className="uat-account__menu-name">{display}</p>
            <p className="uat-account__menu-email">{user.email}</p>
          </div>

          {extraItems}

          <button
            type="button"
            className="uat-account__menu-item"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
          >
            Sign out
          </button>
          <button
            type="button"
            className="uat-account__menu-item uat-account__menu-item--danger"
            onClick={() => {
              setOpen(false);
              void logoutAll();
            }}
          >
            Sign out everywhere
          </button>
        </div>
      )}
    </div>
  );
}

function cls(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(' ');
}
