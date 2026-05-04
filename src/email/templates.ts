// Hard-coded English email templates. siteName + siteUrl are interpolated;
// no other theming or i18n in v1. Override by forking the package or by passing
// custom template options to the auth/teams plugins.

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

interface AddedToTeamArgs {
  siteName: string;
  siteUrl: string;
  teamName: string;
  addedByName: string | null;
  addedByEmail?: string;
}

export function addedToTeamEmail(args: AddedToTeamArgs): RenderedEmail {
  const adderDisplay = args.addedByName ?? args.addedByEmail ?? 'A teammate';
  const safeSiteName = escapeHtml(args.siteName);
  const safeTeamName = escapeHtml(args.teamName);
  const safeAdder = escapeHtml(adderDisplay);
  const subject = `You were added to ${args.teamName}`;

  const text =
    `${adderDisplay} added you to "${args.teamName}" on ${args.siteName}.\n\n` +
    `Open ${args.siteUrl} to see the team.\n\n` +
    `If you don't want to be a member, you can leave the team at any time.\n`;

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
                <h1 style="margin:0 0 16px 0;font-size:20px;font-weight:600;letter-spacing:-0.01em;color:#f1f5f9;">You were added to ${safeTeamName}</h1>
                <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#cbd5e1;"><strong>${safeAdder}</strong> added you to the team <strong>${safeTeamName}</strong> on ${safeSiteName}.</p>
                <p style="margin:0 0 24px 0;">
                  <a href="${args.siteUrl}" style="display:inline-block;padding:12px 24px;background:#06b6d4;color:#0b0e10;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">Open ${safeSiteName}</a>
                </p>
                <p style="margin:0;font-size:13px;color:#64748b;">If you don't want to be a member, you can leave the team at any time.</p>
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

interface SignupAddedToTeamArgs {
  siteName: string;
  siteUrl: string;
  teamName: string;
  addedByName: string | null;
  addedByEmail?: string;
  signinUrl: string;
}

export function signupAddedToTeamEmail(args: SignupAddedToTeamArgs): RenderedEmail {
  const adderDisplay = args.addedByName ?? args.addedByEmail ?? 'A teammate';
  const safeSiteName = escapeHtml(args.siteName);
  const safeTeamName = escapeHtml(args.teamName);
  const safeAdder = escapeHtml(adderDisplay);
  const subject = `${adderDisplay} added you to ${args.teamName}`;

  const text =
    `${adderDisplay} added you to "${args.teamName}" on ${args.siteName}.\n\n` +
    `Sign in with this email to see the team. We'll set up your account on first sign-in.\n\n` +
    `${args.signinUrl}\n`;

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
                <h1 style="margin:0 0 16px 0;font-size:20px;font-weight:600;letter-spacing:-0.01em;color:#f1f5f9;">You were added to ${safeTeamName}</h1>
                <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#cbd5e1;"><strong>${safeAdder}</strong> added you to <strong>${safeTeamName}</strong> on ${safeSiteName}. Sign in with this email and your account will be created automatically.</p>
                <p style="margin:0 0 24px 0;">
                  <a href="${args.signinUrl}" style="display:inline-block;padding:12px 24px;background:#06b6d4;color:#0b0e10;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">Sign in to ${safeSiteName}</a>
                </p>
                <p style="margin:0;font-size:13px;color:#64748b;">If you didn't expect this email, you can safely ignore it.</p>
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
