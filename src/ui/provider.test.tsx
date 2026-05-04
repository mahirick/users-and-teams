import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';
import { UsersAndTeamsProvider, useAuth } from './provider.js';

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function makeFetchStub(handlers: Record<string, () => Response>): {
  fetch: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, ...(init !== undefined ? { init } : {}) });
    const handler = handlers[url] ?? handlers[new URL(url, 'http://x').pathname];
    if (!handler) throw new Error(`Unhandled fetch: ${url}`);
    return handler();
  };
  return { fetch: fetchFn, calls };
}

function Probe() {
  const auth = useAuth();
  return (
    <div>
      <div data-testid="loading">{String(auth.loading)}</div>
      <div data-testid="user">{auth.user ? auth.user.email : 'null'}</div>
    </div>
  );
}

describe('UsersAndTeamsProvider + useAuth', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('starts in loading state and resolves to user from /auth/me', async () => {
    const { fetch } = makeFetchStub({
      '/auth/me': () =>
        new Response(
          JSON.stringify({
            user: {
              id: '1',
              email: 'a@example.com',
              displayName: 'Alice',
              role: 'user',
            },
          }),
          { status: 200 },
        ),
    });

    render(
      <UsersAndTeamsProvider apiBase="" fetch={fetch}>
        <Probe />
      </UsersAndTeamsProvider>,
    );

    expect(screen.getByTestId('loading').textContent).toBe('true');
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });
    expect(screen.getByTestId('user').textContent).toBe('a@example.com');
  });

  it('resolves user=null when /auth/me returns 401', async () => {
    const { fetch } = makeFetchStub({
      '/auth/me': () => new Response('', { status: 401 }),
    });

    render(
      <UsersAndTeamsProvider apiBase="" fetch={fetch}>
        <Probe />
      </UsersAndTeamsProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('loading').textContent).toBe('false'),
    );
    expect(screen.getByTestId('user').textContent).toBe('null');
  });

  it('requestLink POSTs to /auth/request-link', async () => {
    let posted = false;
    const { fetch, calls } = makeFetchStub({
      '/auth/me': () => new Response('', { status: 401 }),
      '/auth/request-link': () => {
        posted = true;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    function Trigger() {
      const auth = useAuth();
      return (
        <button onClick={() => auth.requestLink('a@example.com')}>send</button>
      );
    }

    render(
      <UsersAndTeamsProvider apiBase="" fetch={fetch}>
        <Trigger />
      </UsersAndTeamsProvider>,
    );

    await waitFor(() => expect(calls.find((c) => c.url === '/auth/me')).toBeDefined());

    await act(async () => {
      screen.getByText('send').click();
    });

    expect(posted).toBe(true);
    const requestLinkCall = calls.find((c) => c.url === '/auth/request-link')!;
    expect(requestLinkCall.init?.method).toBe('POST');
    expect(JSON.parse(requestLinkCall.init?.body as string)).toEqual({
      email: 'a@example.com',
    });
  });

  it('logout clears user state', async () => {
    let meStatus = 200;
    const { fetch } = makeFetchStub({
      '/auth/me': () =>
        new Response(
          JSON.stringify({
            user: { id: '1', email: 'a@example.com', displayName: null, role: 'user' },
          }),
          { status: meStatus },
        ),
      '/auth/logout': () => {
        meStatus = 401;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    function Trigger() {
      const auth = useAuth();
      return (
        <div>
          <div data-testid="user">{auth.user ? auth.user.email : 'null'}</div>
          <button onClick={() => auth.logout()}>out</button>
        </div>
      );
    }

    render(
      <UsersAndTeamsProvider apiBase="" fetch={fetch}>
        <Trigger />
      </UsersAndTeamsProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('a@example.com'));

    await act(async () => {
      screen.getByText('out').click();
    });

    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('null'));
  });

  it('uses default fetch when none is provided', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: 401 }),
    );
    try {
      render(
        <UsersAndTeamsProvider apiBase="">
          <Probe />
        </UsersAndTeamsProvider>,
      );
      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalled();
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
