// Resend.com email transport. Uses fetch directly to avoid taking a hard
// dependency on the Resend SDK — the API surface is one POST.

import type { EmailMessage, EmailTransport } from './types.js';

interface ResendOptions {
  apiKey: string;
  from: string;
  /** Override fetch (e.g. for testing). Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Override base URL. Defaults to https://api.resend.com */
  baseUrl?: string;
}

export function resendTransport(opts: ResendOptions): EmailTransport {
  const fetchFn = opts.fetch ?? fetch;
  const baseUrl = opts.baseUrl ?? 'https://api.resend.com';

  return {
    async send(message: EmailMessage): Promise<void> {
      const res = await fetchFn(`${baseUrl}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: opts.from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Resend send failed: ${res.status} ${detail}`);
      }
    },
  };
}
