import { afterEach, describe, expect, it, vi } from 'vitest';
import { resendTransport } from './resend.js';

describe('resendTransport', () => {
  afterEach(() => vi.restoreAllMocks());

  it('POSTs the message to api.resend.com with the API key', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 }),
    );
    const t = resendTransport({
      apiKey: 'test-key',
      from: 'noreply@example.com',
      fetch: fetchMock,
    });

    await t.send({
      to: 'dest@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0]!;
    const url = call[0];
    const init = call[1];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer test-key',
      'Content-Type': 'application/json',
    });

    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({
      from: 'noreply@example.com',
      to: 'dest@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
    });
  });

  it('throws on non-2xx with the response body in the error message', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ error: 'invalid_from' }), { status: 422 }),
    );
    const t = resendTransport({
      apiKey: 'k',
      from: 'noreply@example.com',
      fetch: fetchMock,
    });

    await expect(
      t.send({ to: 'a@example.com', subject: 's', html: 'h', text: 't' }),
    ).rejects.toThrow(/422/);
  });
});
