// Hard-coded English email templates. siteName + siteUrl are interpolated;
// no other theming or i18n in v1. Override by forking the package or by passing
// a custom templates option to the auth plugin (Stage 2).

import type { RenderedEmail } from './types.js';

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

interface MagicLinkArgs {
  siteName: string;
  siteUrl: string;
  link: string;
}

export function magicLinkEmail(args: MagicLinkArgs): RenderedEmail {
  const safeSiteName = escapeHtml(args.siteName);
  const subject = `Sign in to ${args.siteName}`;

  const text =
    `Sign in to ${args.siteName}\n\n` +
    `Click the link below to sign in. The link is valid for 15 minutes.\n\n` +
    `${args.link}\n\n` +
    `If you didn't request this email, you can safely ignore it.\n`;

  const html = /* html */ `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${safeSiteName}</title>
  </head>
  <body style="margin:0;padding:0;background:#0b0e10;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e2e8f0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:48px 24px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:480px;background:#14181b;border:1px solid #1f2937;border-radius:12px;padding:32px;">
            <tr>
              <td>
                <h1 style="margin:0 0 16px 0;font-size:20px;font-weight:600;letter-spacing:-0.01em;color:#f1f5f9;">Sign in to ${safeSiteName}</h1>
                <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#cbd5e1;">Click the button below to sign in. This link is valid for 15 minutes.</p>
                <p style="margin:0 0 24px 0;">
                  <a href="${args.link}" style="display:inline-block;padding:12px 24px;background:#06b6d4;color:#0b0e10;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">Sign in</a>
                </p>
                <p style="margin:0 0 8px 0;font-size:13px;color:#94a3b8;">Or copy this URL into your browser:</p>
                <p style="margin:0 0 24px 0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;color:#94a3b8;word-break:break-all;">${args.link}</p>
                <p style="margin:0;font-size:13px;color:#64748b;">If you didn't request this email, you can safely ignore it.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}

interface InviteArgs {
  siteName: string;
  siteUrl: string;
  teamName: string;
  inviterName: string | null;
  inviterEmail?: string;
  link: string;
}

export function inviteEmail(args: InviteArgs): RenderedEmail {
  const inviterDisplay = args.inviterName ?? args.inviterEmail ?? 'A teammate';
  const safeSiteName = escapeHtml(args.siteName);
  const safeTeamName = escapeHtml(args.teamName);
  const safeInviter = escapeHtml(inviterDisplay);
  const subject = `${inviterDisplay} invited you to ${args.teamName}`;

  const text =
    `${inviterDisplay} invited you to join "${args.teamName}" on ${args.siteName}.\n\n` +
    `Click the link below to accept the invite (valid for 7 days):\n\n` +
    `${args.link}\n\n` +
    `If you didn't expect this email, you can safely ignore it.\n`;

  const html = /* html */ `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${safeSiteName}</title>
  </head>
  <body style="margin:0;padding:0;background:#0b0e10;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e2e8f0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:48px 24px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:480px;background:#14181b;border:1px solid #1f2937;border-radius:12px;padding:32px;">
            <tr>
              <td>
                <h1 style="margin:0 0 16px 0;font-size:20px;font-weight:600;letter-spacing:-0.01em;color:#f1f5f9;">You're invited to ${safeTeamName}</h1>
                <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#cbd5e1;"><strong>${safeInviter}</strong> invited you to join the team <strong>${safeTeamName}</strong> on ${safeSiteName}.</p>
                <p style="margin:0 0 24px 0;">
                  <a href="${args.link}" style="display:inline-block;padding:12px 24px;background:#06b6d4;color:#0b0e10;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">Accept invite</a>
                </p>
                <p style="margin:0 0 8px 0;font-size:13px;color:#94a3b8;">Or copy this URL into your browser:</p>
                <p style="margin:0 0 24px 0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;color:#94a3b8;word-break:break-all;">${args.link}</p>
                <p style="margin:0;font-size:13px;color:#64748b;">This invite is valid for 7 days. If you didn't expect this email, you can safely ignore it.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}
