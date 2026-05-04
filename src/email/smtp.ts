// SMTP email transport — wraps nodemailer. Optional peer dep, only loaded when
// the consumer actually calls `smtpTransport(...)`. We import it dynamically to
// avoid bundlers complaining when nodemailer isn't installed.

import type { EmailMessage, EmailTransport } from './types.js';

export interface SmtpOptions {
  /** SMTP server host (e.g. "smtp.example.com"). */
  host: string;
  /** SMTP port. 465 for implicit TLS; 587 for STARTTLS. */
  port: number;
  /** From address. Required by every transport. */
  from: string;
  /** Use implicit TLS (typical for port 465). */
  secure?: boolean;
  /** Auth — pass an object only if the server requires authentication. */
  auth?: { user: string; pass: string };
  /** Override the transporter factory (used by the test). */
  createTransport?: (config: unknown) => {
    sendMail: (msg: unknown) => Promise<unknown>;
  };
}

/**
 * Build an EmailTransport that delivers via SMTP using nodemailer.
 *
 * `nodemailer` is an *optional* peer dependency — install it in your
 * consumer app if you want to use this transport:
 *
 * ```bash
 * npm install nodemailer
 * ```
 */
export function smtpTransport(opts: SmtpOptions): EmailTransport {
  type SendMailLike = (msg: unknown) => Promise<unknown>;
  let sendMailPromise: Promise<SendMailLike> | null = null;

  function getSendMail(): Promise<SendMailLike> {
    if (sendMailPromise) return sendMailPromise;
    sendMailPromise = (async () => {
      if (opts.createTransport) {
        const t = opts.createTransport({
          host: opts.host,
          port: opts.port,
          secure: opts.secure ?? opts.port === 465,
          auth: opts.auth,
        });
        return t.sendMail.bind(t) as SendMailLike;
      }
      const nodemailer = await import('nodemailer').catch(() => {
        throw new Error(
          'smtpTransport requires the "nodemailer" peer dependency. Run: npm install nodemailer',
        );
      });
      const t = nodemailer.createTransport({
        host: opts.host,
        port: opts.port,
        secure: opts.secure ?? opts.port === 465,
        auth: opts.auth,
      });
      return ((msg: unknown) => t.sendMail(msg as never) as Promise<unknown>) as SendMailLike;
    })();
    return sendMailPromise;
  }

  return {
    async send(message: EmailMessage): Promise<void> {
      const sendMail = await getSendMail();
      await sendMail({
        from: opts.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
    },
  };
}
