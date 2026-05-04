// Account menu shown in app header. Renders a "Sign in" link if no user; once
// signed in, shows an avatar that opens a dropdown with profile + actions
// (edit display name, sign out, delete account).

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../provider.js';
import { Avatar } from './Avatar.js';
import { AvatarUploader } from './AvatarUploader.js';

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
  const { user, loading, logout, logoutAll, updateDisplayName, deleteAccount, uploadAvatar, removeAvatar } = useAuth();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setEditing(false);
        setConfirmDelete(false);
      }
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

  return (
    <div className={cls('uat-account', className)} ref={ref}>
      <button
        type="button"
        className="uat-account__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar
          initials={user.avatarInitials}
          color={user.avatarColor}
          url={user.avatarUrl}
          size="md"
          label={display}
        />
        <span className="uat-account__name">{display}</span>
      </button>

      {open && (
        <div className="uat-account__menu" role="menu">
          <div className="uat-account__menu-header">
            <Avatar
              initials={user.avatarInitials}
              color={user.avatarColor}
              url={user.avatarUrl}
              size="lg"
              label={display}
            />
            <div style={{ minWidth: 0, flex: 1 }}>
              {editing ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (saving || draftName.trim().length === 0) return;
                    setSaving(true);
                    const res = await updateDisplayName(draftName.trim());
                    setSaving(false);
                    if (res.ok) {
                      setEditing(false);
                    }
                  }}
                  style={{ display: 'flex', gap: 6 }}
                >
                  <input
                    autoFocus
                    className="uat-login__input"
                    style={{ fontSize: 13, padding: '4px 8px' }}
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    aria-label="Display name"
                    maxLength={120}
                  />
                  <button
                    type="submit"
                    className="uat-login__button"
                    style={{ padding: '4px 10px', fontSize: 12 }}
                    disabled={saving || draftName.trim().length === 0}
                  >
                    Save
                  </button>
                </form>
              ) : (
                <>
                  <p className="uat-account__menu-name">{display}</p>
                  <p className="uat-account__menu-email">{user.email}</p>
                  {user.role === 'owner' && (
                    <p className="uat-account__menu-role">Owner</p>
                  )}
                </>
              )}
            </div>
          </div>

          {!editing && (
            <button
              type="button"
              className="uat-account__menu-item"
              onClick={() => {
                setDraftName(user.displayName ?? '');
                setEditing(true);
              }}
            >
              Edit display name
            </button>
          )}

          <div style={{ padding: '6px 4px' }}>
            <AvatarUploader
              currentUrl={user.avatarUrl}
              initials={user.avatarInitials}
              color={user.avatarColor}
              label={display}
              onUpload={(dataUrl) => uploadAvatar(dataUrl)}
              onRemove={() => removeAvatar()}
            />
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
            className="uat-account__menu-item"
            onClick={() => {
              setOpen(false);
              void logoutAll();
            }}
          >
            Sign out everywhere
          </button>

          {!confirmDelete ? (
            <button
              type="button"
              className="uat-account__menu-item uat-account__menu-item--danger"
              onClick={() => setConfirmDelete(true)}
            >
              Delete account…
            </button>
          ) : (
            <div
              style={{
                margin: '4px 0 0',
                padding: '8px 10px',
                borderTop: '1px solid var(--uat-border-light)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <p style={{ margin: 0, fontSize: 12, color: 'var(--uat-text-muted)' }}>
                Permanently delete your account? This signs you out and removes
                your team memberships. It cannot be undone.
              </p>
              {deleteError && (
                <p className="uat-login__error" role="alert" style={{ margin: 0 }}>
                  {deleteError}
                </p>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="uat-account__menu-item"
                  style={{ flex: 1, textAlign: 'center' }}
                  onClick={() => {
                    setConfirmDelete(false);
                    setDeleteError(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="uat-account__menu-item uat-account__menu-item--danger"
                  style={{ flex: 1, textAlign: 'center' }}
                  onClick={async () => {
                    const res = await deleteAccount();
                    if (!res.ok) {
                      setDeleteError(
                        res.error === 'OWNER_SELF_DELETE'
                          ? 'Owners cannot delete their own account.'
                          : 'Could not delete account.',
                      );
                    } else {
                      setOpen(false);
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function cls(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(' ');
}
