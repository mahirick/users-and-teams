// Development email transport. Logs the message + extracts the first link from
// the body so you can copy-paste it into a browser. Also supports a capture
// mode for tests (see ConsoleTransport.captured).

import type { EmailMessage, EmailTransport } from './types.js';

interface ConsoleTransportOptions {
  log?: (line: string) => void;
  /** When true, do not log; just append to `captured`. */
  captureOnly?: boolean;
}

export interface ConsoleTransport extends EmailTransport {
  captured: EmailMessage[];
}

export function consoleTransport(opts: ConsoleTransportOptions = {}): ConsoleTransport {
  const captured: EmailMessage[] = [];
  const log = opts.log ?? ((line: string) => console.log(line));

  return {
    captured,
    async send(message: EmailMessage): Promise<void> {
      captured.push(message);
      if (opts.captureOnly) return;

      const link = extractFirstHttpsLink(message.text) ?? extractFirstHttpsLink(message.html);
      const linkPart = link ? ` link=${link}` : '';
      log(`[email] to=${message.to} subject="${message.subject}"${linkPart}`);
    },
  };
}

function extractFirstHttpsLink(body: string): string | null {
  const match = body.match(/https:\/\/[^\s"'<>]+/);
  return match ? match[0] : null;
}
