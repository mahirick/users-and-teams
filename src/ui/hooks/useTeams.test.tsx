import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { UsersAndTeamsProvider } from '../provider.js';
import { useTeams } from './useTeams.js';

interface TeamMembership {
  team: {
    id: string;
    name: string;
    nameNormalized: string;
    adminId: string;
    avatarColor: string;
    avatarInitials: string;
    createdAt: number;
  };
  role: 'admin' | 'user';
}

function makeFetchStub(handlers: Record<string, () => Response>): typeof fetch {
  return async (input) => {
    const url = typeof input === 'string' ? input : input.toString();
    const handler = handlers[url];
    if (!handler) throw new Error(`Unhandled fetch: ${url}`);
    return handler();
  };
}

const meHandler = () =>
  new Response(
    JSON.stringify({
      user: {
        id: 'u1',
        email: 'u@x.com',
        displayName: 'U',
        role: 'user',
        avatarColor: '#0EA5E9',
        avatarInitials: 'U',
      },
    }),
    { status: 200 },
  );

const teamFixture = (id: string, name: string): TeamMembership['team'] => ({
  id,
  name,
  nameNormalized: name.toLowerCase(),
  adminId: 'u1',
  avatarColor: '#0EA5E9',
  avatarInitials: name[0]!.toUpperCase(),
  createdAt: 0,
});

describe('useTeams', () => {
  it('loads teams from /teams when user is signed in', async () => {
    const teams: TeamMembership[] = [
      { team: teamFixture('t1', 'Eng'), role: 'admin' },
    ];
    const fetchStub = makeFetchStub({
      '/auth/me': meHandler,
      '/teams': () =>
        new Response(JSON.stringify({ teams }), { status: 200 }),
    });

    function Probe() {
      const t = useTeams();
      return (
        <div>
          <span data-testid="loading">{String(t.loading)}</span>
          <span data-testid="count">{t.teams.length}</span>
          {t.teams.map((m) => (
            <span key={m.team.id} data-testid={`team-${m.team.id}`}>
              {m.team.name}/{m.role}
            </span>
          ))}
        </div>
      );
    }

    render(
      <UsersAndTeamsProvider apiBase="" fetch={fetchStub}>
        <Probe />
      </UsersAndTeamsProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
    expect(screen.getByTestId('team-t1').textContent).toBe('Eng/admin');
  });

  it('createTeam POSTs to /teams and refreshes the list', async () => {
    const teams: TeamMembership[] = [];
    let teamsResponseTeams = teams;
    const fetchStub = makeFetchStub({
      '/auth/me': meHandler,
      '/teams': () =>
        new Response(JSON.stringify({ teams: teamsResponseTeams }), { status: 200 }),
    });
    const fetchAny = vi.fn(fetchStub);

    function Trigger() {
      const t = useTeams();
      return (
        <div>
          <span data-testid="count">{t.teams.length}</span>
          <button
            onClick={async () => {
              teamsResponseTeams = [{ team: teamFixture('t1', 'New'), role: 'admin' }];
              await t.createTeam('New');
            }}
          >
            create
          </button>
        </div>
      );
    }

    render(
      <UsersAndTeamsProvider apiBase="" fetch={fetchAny as typeof fetch}>
        <Trigger />
      </UsersAndTeamsProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'));

    fetchAny.mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/teams' && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ team: teamFixture('t1', 'New') }),
          { status: 201 },
        );
      }
      return fetchStub(input, init);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('create'));
    });

    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
  });
});
