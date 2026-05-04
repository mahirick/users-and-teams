import { describe, expect, it, vi } from 'vitest';
import { smtpTransport } from './smtp.js';

describe('smtpTransport', () => {
  it('delivers message via the injected createTransport factory', async () => {
    const sendMail = vi.fn().mockResolvedValue({});
    const transport = smtpTransport({
      host: 'smtp.example.com',
      port: 587,
      from: 'noreply@example.com',
      auth: { user: 'u', pass: 'p' },
      createTransport: () => ({ sendMail }),
    });
    await transport.send({
      to: 'a@example.com',
      subject: 'hi',
      html: '<p>hi</p>',
      text: 'hi',
    });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0]![0]).toMatchObject({
      from: 'noreply@example.com',
      to: 'a@example.com',
      subject: 'hi',
    });
  });

  it('reuses one transporter across multiple sends', async () => {
    const factory = vi.fn(() => ({ sendMail: vi.fn().mockResolvedValue({}) }));
    const transport = smtpTransport({
      host: 'smtp.example.com',
      port: 465,
      from: 'noreply@example.com',
      createTransport: factory,
    });
    await transport.send({ to: 'a@example.com', subject: 'a', html: '', text: '' });
    await transport.send({ to: 'b@example.com', subject: 'b', html: '', text: '' });
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
