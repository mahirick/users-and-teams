import { describe, expect, it } from 'vitest';
import { magicLinkEmail, inviteEmail } from './templates.js';

describe('magicLinkEmail', () => {
  it('renders subject with site name', () => {
    const e = magicLinkEmail({
      siteName: 'My App',
      siteUrl: 'https://app.example.com',
      link: 'https://app.example.com/auth/verify?token=abc',
    });
    expect(e.subject).toContain('My App');
  });

  it('renders the link in both html and text bodies', () => {
    const link = 'https://app.example.com/auth/verify?token=xyz';
    const e = magicLinkEmail({ siteName: 'App', siteUrl: 'https://app.example.com', link });
    expect(e.html).toContain(link);
    expect(e.text).toContain(link);
  });

  it('html is minimally valid (has <html> and link as <a href>)', () => {
    const link = 'https://app.example.com/auth/verify?token=x';
    const e = magicLinkEmail({ siteName: 'App', siteUrl: 'https://app.example.com', link });
    expect(e.html).toMatch(/<html/i);
    expect(e.html).toContain(`href="${link}"`);
  });

  it('escapes HTML in siteName', () => {
    const e = magicLinkEmail({
      siteName: 'My <App>',
      siteUrl: 'https://app.example.com',
      link: 'https://app.example.com/x',
    });
    expect(e.html).not.toContain('<App>');
    expect(e.html).toContain('My &lt;App&gt;');
  });
});

describe('inviteEmail', () => {
  it('mentions the team name and inviter', () => {
    const e = inviteEmail({
      siteName: 'App',
      siteUrl: 'https://app.example.com',
      teamName: 'Engineering',
      inviterName: 'Alice',
      link: 'https://app.example.com/invites/accept?token=t',
    });
    expect(e.subject).toContain('Engineering');
    expect(e.text).toContain('Alice');
    expect(e.html).toContain('Engineering');
    expect(e.html).toContain('Alice');
  });

  it('falls back to inviter email when name not provided', () => {
    const e = inviteEmail({
      siteName: 'App',
      siteUrl: 'https://app.example.com',
      teamName: 'Eng',
      inviterName: null,
      inviterEmail: 'alice@example.com',
      link: 'https://app.example.com/x',
    });
    expect(e.text).toContain('alice@example.com');
  });

  it('includes the invite link', () => {
    const link = 'https://app.example.com/invites/accept?token=ABC123';
    const e = inviteEmail({
      siteName: 'App',
      siteUrl: 'https://app.example.com',
      teamName: 'T',
      inviterName: 'A',
      link,
    });
    expect(e.html).toContain(link);
    expect(e.text).toContain(link);
  });
});
