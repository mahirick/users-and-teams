import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { UsersAndTeamsProvider } from '../provider.js';
import { LoginForm } from './LoginForm.js';

function makeFetchStub(handlers: Record<string, () => Response>): typeof fetch {
  return async (input) => {
    const url = typeof input === 'string' ? input : input.toString();
    const handler = handlers[url];
    if (!handler) throw new Error(`Unhandled fetch: ${url}`);
    return handler();
  };
}

function setup(fetchStub: typeof fetch) {
  return render(
    <UsersAndTeamsProvider apiBase="" fetch={fetchStub}>
      <LoginForm siteName="My App" />
    </UsersAndTeamsProvider>,
  );
}

describe('<LoginForm />', () => {
  it('renders an email input and submit button with the site name', async () => {
    const fetchStub = makeFetchStub({
      '/auth/me': () => new Response('', { status: 401 }),
    });
    setup(fetchStub);

    expect(screen.getByText(/sign in to my app/i)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /email/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send magic link/i })).toBeInTheDocument();
  });

  it('shows a success message after submitting a valid email', async () => {
    const fetchStub = makeFetchStub({
      '/auth/me': () => new Response('', { status: 401 }),
      '/auth/request-link': () =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
    });
    setup(fetchStub);

    const input = screen.getByRole('textbox', { name: /email/i }) as HTMLInputElement;
    const button = screen.getByRole('button', { name: /send magic link/i });

    await act(async () => {
      fireEvent.change(input, { target: { value: 'a@example.com' } });
    });

    await act(async () => {
      button.click();
    });

    await waitFor(() => {
      expect(screen.getByText(/check your inbox/i)).toBeInTheDocument();
    });
  });

  it('shows an error message when the API returns 400', async () => {
    const fetchStub = makeFetchStub({
      '/auth/me': () => new Response('', { status: 401 }),
      '/auth/request-link': () =>
        new Response(JSON.stringify({ error: 'invalid_email' }), { status: 400 }),
    });
    setup(fetchStub);

    const input = screen.getByRole('textbox', { name: /email/i }) as HTMLInputElement;
    const button = screen.getByRole('button', { name: /send magic link/i });

    await act(async () => {
      fireEvent.change(input, { target: { value: 'bad' } });
    });
    await act(async () => button.click());

    await waitFor(() => {
      expect(screen.getByText(/please enter a valid email/i)).toBeInTheDocument();
    });
  });

  it('shows a rate-limit message when the API returns 429', async () => {
    const fetchStub = makeFetchStub({
      '/auth/me': () => new Response('', { status: 401 }),
      '/auth/request-link': () =>
        new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 }),
    });
    setup(fetchStub);

    const input = screen.getByRole('textbox', { name: /email/i }) as HTMLInputElement;
    const button = screen.getByRole('button', { name: /send magic link/i });

    await act(async () => {
      fireEvent.change(input, { target: { value: 'a@example.com' } });
    });
    await act(async () => button.click());

    await waitFor(() => {
      expect(screen.getByText(/too many requests/i)).toBeInTheDocument();
    });
  });

  it('disables submit while the request is in flight', async () => {
    let resolve!: () => void;
    const inflight = new Promise<void>((r) => (resolve = r));
    const fetchStub = makeFetchStub({
      '/auth/me': () => new Response('', { status: 401 }),
      '/auth/request-link': () =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
    });
    // Wrap to add delay
    const delayed: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/auth/request-link') {
        await inflight;
      }
      return fetchStub(input, init);
    };
    setup(delayed);

    const input = screen.getByRole('textbox', { name: /email/i }) as HTMLInputElement;
    const button = screen.getByRole('button', {
      name: /send magic link/i,
    }) as HTMLButtonElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: 'a@example.com' } });
    });
    act(() => {
      button.click();
    });

    await waitFor(() => expect(button.disabled).toBe(true));

    await act(async () => {
      resolve();
    });
  });
});
