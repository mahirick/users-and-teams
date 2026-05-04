import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { UsersAndTeamsProvider, type PublicUser } from '../provider.js';
import { AccountMenu } from './AccountMenu.js';

function makeFetchStub(handlers: Record<string, () => Response>): typeof fetch {
  return async (input) => {
    const url = typeof input === 'string' ? input : input.toString();
    const handler = handlers[url];
    if (!handler) throw new Error(`Unhandled fetch: ${url}`);
    return handler();
  };
}

function meWith(user: PublicUser | null) {
  return user
    ? () => new Response(JSON.stringify({ user }), { status: 200 })
    : () => new Response('', { status: 401 });
}

describe('<AccountMenu />', () => {
  it('renders a "Sign in" link when user is null', async () => {
    const fetchStub = makeFetchStub({ '/auth/me': meWith(null) });
    render(
      <UsersAndTeamsProvider apiBase="" fetch={fetchStub}>
        <AccountMenu signInHref="/login" />
      </UsersAndTeamsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
    });
  });

  it('renders nothing during loading by default', () => {
    const fetchStub = makeFetchStub({ '/auth/me': () => new Response('', { status: 401 }) });
    const { container } = render(
      <UsersAndTeamsProvider apiBase="" fetch={fetchStub}>
        <AccountMenu />
      </UsersAndTeamsProvider>,
    );
    // While loading, AccountMenu renders a placeholder (or nothing)
    expect(container.querySelector('.uat-account__menu')).toBeNull();
  });

  it('renders an avatar with the first letter of email when user is logged in', async () => {
    const fetchStub = makeFetchStub({
      '/auth/me': meWith({ id: '1', email: 'alice@example.com', displayName: null, role: 'user', avatarColor: '#0EA5E9', avatarInitials: 'A' }),
    });
    render(
      <UsersAndTeamsProvider apiBase="" fetch={fetchStub}>
        <AccountMenu />
      </UsersAndTeamsProvider>,
    );
    await waitFor(() => {
      // Avatar visible with initial 'A' from the precomputed avatarInitials
      expect(screen.getByText('A', { selector: '.uat-avatar__text' })).toBeInTheDocument();
    });
  });

  it('uses displayName when present', async () => {
    const fetchStub = makeFetchStub({
      '/auth/me': meWith({ id: '1', email: 'a@example.com', displayName: 'Alice', role: 'user', avatarColor: '#0EA5E9', avatarInitials: 'A' }),
    });
    render(
      <UsersAndTeamsProvider apiBase="" fetch={fetchStub}>
        <AccountMenu />
      </UsersAndTeamsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Alice', { selector: '.uat-account__name' })).toBeInTheDocument();
    });
  });

  it('toggles the menu when the trigger is clicked', async () => {
    const fetchStub = makeFetchStub({
      '/auth/me': meWith({ id: '1', email: 'a@example.com', displayName: 'Alice', role: 'user', avatarColor: '#0EA5E9', avatarInitials: 'A' }),
    });
    render(
      <UsersAndTeamsProvider apiBase="" fetch={fetchStub}>
        <AccountMenu />
      </UsersAndTeamsProvider>,
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /alice/i })).toBeInTheDocument(),
    );

    expect(screen.queryByText(/sign out everywhere/i)).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /alice/i }));
    });
    expect(screen.getByText(/sign out everywhere/i)).toBeInTheDocument();
  });

  it('calls logout when "Sign out" is clicked', async () => {
    let logoutCalled = false;
    const fetchStub = makeFetchStub({
      '/auth/me': meWith({ id: '1', email: 'a@example.com', displayName: 'Alice', role: 'user', avatarColor: '#0EA5E9', avatarInitials: 'A' }),
      '/auth/logout': () => {
        logoutCalled = true;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });
    render(
      <UsersAndTeamsProvider apiBase="" fetch={fetchStub}>
        <AccountMenu />
      </UsersAndTeamsProvider>,
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /alice/i })).toBeInTheDocument(),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /alice/i }));
    });
    await act(async () => {
      // Pick the "Sign out" item — must NOT be "Sign out everywhere"
      const item = screen.getByText('Sign out', { selector: '.uat-account__menu-item' });
      fireEvent.click(item);
    });

    expect(logoutCalled).toBe(true);
  });
});
