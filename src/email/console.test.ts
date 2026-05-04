import { describe, expect, it, vi } from 'vitest';
import { consoleTransport, type ConsoleTransport } from './console.js';

describe('consoleTransport', () => {
  it('logs to provided logger fn', async () => {
    const logged: string[] = [];
    const t = consoleTransport({ log: (line: string) => logged.push(line) });
    await t.send({
      to: 'dest@example.com',
      subject: 'Test',
      html: '<p>x</p>',
      text: 'x',
    });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('dest@example.com');
    expect(logged[0]).toContain('Test');
  });

  it('extracts the first https link from the body for easy copy/paste', async () => {
    const logged: string[] = [];
    const t = consoleTransport({ log: (line) => logged.push(line) });
    await t.send({
      to: 'a@example.com',
      subject: 'S',
      html: '<a href="https://app.example.com/auth/verify?token=ABC">x</a>',
      text: 'visit https://app.example.com/auth/verify?token=ABC',
    });
    expect(logged.join('\n')).toContain('https://app.example.com/auth/verify?token=ABC');
  });

  it('captures messages when given the captured-mode option', async () => {
    const t: ConsoleTransport = consoleTransport({ captureOnly: true });
    await t.send({ to: 'a@example.com', subject: 'S', html: 'h', text: 't' });
    expect(t.captured).toHaveLength(1);
    expect(t.captured[0]?.to).toBe('a@example.com');
  });

  it('uses console.log by default', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const t = consoleTransport();
      await t.send({ to: 'x@example.com', subject: 'X', html: 'h', text: 't' });
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
