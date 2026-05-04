// TeamProfile — small inline-editable header for a team. Shows the team
// avatar + name, and lets the team's Admin click "Rename" to change the
// name in place. Hits PATCH /teams/:id.

import { useContext, useEffect, useState } from 'react';
import { ProviderConfigContext } from '../provider-internal.js';
import { Avatar } from './Avatar.js';
import { AvatarUploader } from './AvatarUploader.js';

export interface TeamProfileProps {
  teamId: string;
  /** Called after a successful rename. */
  onRenamed?: (newName: string) => void;
  className?: string;
}

interface TeamShape {
  id: string;
  name: string;
  nameNormalized: string;
  adminId: string;
  avatarColor: string;
  avatarInitials: string;
  avatarUrl: string | null;
  createdAt: number;
}

interface MeShape {
  id: string;
  role: 'user' | 'owner';
}

export function TeamProfile({ teamId, onRenamed, className }: TeamProfileProps) {
  const config = useContext(ProviderConfigContext);
  const [team, setTeam] = useState<TeamShape | null>(null);
  const [me, setMe] = useState<MeShape | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [teamRes, meRes] = await Promise.all([
      config.fetch(`${config.apiBase}/teams/${teamId}`, { credentials: 'include' }),
      config.fetch(`${config.apiBase}/auth/me`, { credentials: 'include' }),
    ]);
    if (teamRes.ok) {
      const data = (await teamRes.json()) as { team: TeamShape };
      setTeam(data.team);
      setDraft(data.team.name);
    }
    if (meRes.ok) {
      const data = (await meRes.json()) as { user: MeShape };
      setMe(data.user);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  if (!team) return null;

  const canRename = me?.role === 'owner' || team.adminId === me?.id;

  async function save() {
    if (busy || draft.trim().length === 0 || draft.trim() === team!.name) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await config.fetch(`${config.apiBase}/teams/${teamId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: draft.trim() }),
      });
      if (res.ok) {
        const data = (await res.json()) as { team: TeamShape };
        setTeam(data.team);
        setEditing(false);
        onRenamed?.(data.team.name);
      } else if (res.status === 409) {
        setError('That team name is already taken.');
      } else if (res.status === 403) {
        setError("You don't have permission to rename this team.");
      } else {
        setError('Could not rename the team.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function uploadTeamAvatar(dataUrl: string): Promise<{ ok: boolean; error?: string }> {
    const res = await config.fetch(`${config.apiBase}/teams/${teamId}/avatar`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: dataUrl }),
    });
    if (res.ok) {
      const data = (await res.json()) as { team: TeamShape };
      setTeam(data.team);
      return { ok: true };
    }
    if (res.status === 501) return { ok: false, error: 'avatar_store_not_configured' };
    return { ok: false, error: 'unknown' };
  }

  async function removeTeamAvatar(): Promise<{ ok: boolean; error?: string }> {
    const res = await config.fetch(`${config.apiBase}/teams/${teamId}/avatar`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.ok) {
      const data = (await res.json()) as { team: TeamShape };
      setTeam(data.team);
      return { ok: true };
    }
    return { ok: false, error: 'unknown' };
  }

  return (
    <div className={className}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
      <Avatar
        initials={team.avatarInitials}
        color={team.avatarColor}
        url={team.avatarUrl}
        size="lg"
        label={team.name}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
            style={{ display: 'flex', gap: 8, alignItems: 'center' }}
          >
            <input
              autoFocus
              className="uat-login__input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={120}
              aria-label="Team name"
              style={{ flex: 1, fontSize: 18, fontWeight: 600 }}
            />
            <button
              type="submit"
              className="uat-login__button"
              style={{ padding: '8px 14px' }}
              disabled={busy || draft.trim().length === 0}
            >
              Save
            </button>
            <button
              type="button"
              className="uat-account__menu-item"
              style={{ padding: '8px 14px', display: 'inline-block', width: 'auto' }}
              onClick={() => {
                setEditing(false);
                setDraft(team.name);
                setError(null);
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>
              {team.name}
            </h1>
            {canRename && (
              <button
                type="button"
                className="uat-account__menu-item"
                style={{ padding: '4px 10px', display: 'inline-block', width: 'auto', fontSize: 12 }}
                onClick={() => setEditing(true)}
              >
                Rename
              </button>
            )}
          </div>
        )}
        {error && (
          <p className="uat-login__error" role="alert" style={{ marginTop: 4 }}>
            {error}
          </p>
        )}
      </div>
      </div>
      {canRename && (
        <AvatarUploader
          currentUrl={team.avatarUrl}
          initials={team.avatarInitials}
          color={team.avatarColor}
          label={team.name}
          onUpload={uploadTeamAvatar}
          onRemove={removeTeamAvatar}
        />
      )}
    </div>
  );
}
