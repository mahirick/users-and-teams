import { describe, expect, it } from 'vitest';
import {
  addedToTeamEmail,
  magicLinkEmail,
  signupAddedToTeamEmail,
} from './templates.js';

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

describe('addedToTeamEmail', () => {
  it('mentions the team name and adder', () => {
    const e = addedToTeamEmail({
      siteName: 'App',
      siteUrl: 'https://app.example.com',
      teamName: 'Engineering',
      addedByName: 'Alice',
    });
    expect(e.subject).toContain('Engineering');
    expect(e.text).toContain('Alice');
    expect(e.html).toContain('Engineering');
  });

  it('falls back to adder email when name is null', () => {
    const e = addedToTeamEmail({
      siteName: 'App',
      siteUrl: 'https://app.example.com',
      teamName: 'Eng',
      addedByName: null,
      addedByEmail: 'alice@example.com',
    });
    expect(e.text).toContain('alice@example.com');
  });
});

describe('signupAddedToTeamEmail', () => {
  it('points the recipient at the sign-in URL', () => {
    const e = signupAddedToTeamEmail({
      siteName: 'App',
      siteUrl: 'https://app.example.com',
      teamName: 'Eng',
      addedByName: 'Alice',
      signinUrl: 'https://app.example.com/',
    });
    expect(e.html).toContain('https://app.example.com/');
    expect(e.text).toContain('https://app.example.com/');
  });
});
