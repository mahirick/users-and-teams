// TeamSwitcher: dropdown listing the current user's teams + a "Create team"
// option. Hosts a small inline create-team form (just a name field).

import { useEffect, useRef, useState } from 'react';
import { useTeams, type TeamMembership } from '../hooks/useTeams.js';
import { Avatar } from './Avatar.js';

export interface TeamSwitcherProps {
  /** Currently selected team id; selection is owned by the consumer. */
  activeTeamId?: string;
  /** Called when a team is picked. */
  onSelect?: (membership: TeamMembership) => void;
  /** Called after a successful create. Defaults to onSelect. */
  onCreate?: (membership: TeamMembership) => void;
  className?: string;
}

export function TeamSwitcher({
  activeTeamId,
  onSelect,
  onCreate,
  className,
}: TeamSwitcherProps) {
  const { teams, loading, createTeam } = useTeams();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const active = teams.find((t) => t.team.id === activeTeamId) ?? teams[0];

  return (
    <div className={cls('uat-teamswitcher', className)} ref={ref}>
      <button
        type="button"
        className="uat-account__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {active ? (
          <>
            <Avatar
              initials={active.team.avatarInitials}
              color={active.team.avatarColor}
              url={active.team.avatarUrl}
              size="sm"
              label={active.team.name}
            />
            <span className="uat-account__name">{active.team.name}</span>
          </>
        ) : (
          <span className="uat-account__name">Teams</span>
        )}
        <span aria-hidden="true" style={{ fontSize: 10, color: '#94a3b8' }}>▼</span>
      </button>

      {open && (
        <div className="uat-account__menu" role="menu">
          {teams.length === 0 && !creating && !loading && (
            <p className="uat-account__menu-email" style={{ padding: '8px 10px' }}>
              You're not in any teams yet.
            </p>
          )}

          {teams.map((m) => (
            <button
              key={m.team.id}
              type="button"
              className="uat-account__menu-item uat-account__menu-item--row"
              onClick={() => {
                setOpen(false);
                onSelect?.(m);
              }}
            >
              <Avatar
                initials={m.team.avatarInitials}
                color={m.team.avatarColor}
                url={m.team.avatarUrl}
                size="sm"
                label={m.team.name}
              />
              <span>{m.team.name}</span>
              {m.role === 'admin' && (
                <span className="uat-pill" aria-label="You are the team admin">Admin</span>
              )}
            </button>
          ))}

          {!creating ? (
            <button
              type="button"
              className="uat-account__menu-item"
              onClick={() => setCreating(true)}
              style={{
                borderTop: '1px solid var(--uat-border-light)',
                marginTop: 4,
                paddingTop: 8,
              }}
            >
              + Create team
            </button>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setError(null);
                const result = await createTeam(name);
                if (result.ok && result.team) {
                  setName('');
                  setCreating(false);
                  setOpen(false);
                  const newMembership: TeamMembership = {
                    team: result.team,
                    role: 'admin',
                  };
                  (onCreate ?? onSelect)?.(newMembership);
                } else {
                  setError(
                    result.error === 'name_taken'
                      ? 'That team name is already taken.'
                      : 'Could not create team.',
                  );
                }
              }}
              style={{
                borderTop: '1px solid var(--uat-border-light)',
                marginTop: 4,
                paddingTop: 8,
                padding: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <input
                className="uat-login__input"
                placeholder="Team name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="Team name"
                required
              />
              <button className="uat-login__button" type="submit">
                Create
              </button>
              {error && <p className="uat-login__error">{error}</p>}
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function cls(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(' ');
}
