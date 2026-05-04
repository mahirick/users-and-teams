import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { UsersAndTeamsProvider } from '../provider.js';
import { useTeams } from './useTeams.js';

interface TeamMembership {
  team: { id: string; name: string; slug: string };
  role: 'owner' | 'admin' | 'member';
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
    JSON.stringify({ user: { id: 'u1', email: 'u@x.com', displayName: 'U', role: 'user' } }),
    { status: 200 },
  );

describe('useTeams', () => {
  it('loads teams from /teams when user is signed in', async () => {
    const teams: TeamMembership[] = [
      { team: { id: 't1', name: 'Eng', slug: 'eng' }, role: 'owner' },
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
            <span key={m.team.id} data-testid={`team-${m.team.slug}`}>
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
    expect(screen.getByTestId('team-eng').textContent).toBe('Eng/owner');
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
              teamsResponseTeams = [
                { team: { id: 't1', name: 'New', slug: 'new' }, role: 'owner' },
              ];
              await t.createTeam('New', 'new');
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

    // Wire the POST /teams handler
    fetchAny.mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/teams' && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ team: { id: 't1', name: 'New', slug: 'new', ownerId: 'u1', createdAt: 0 } }),
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
