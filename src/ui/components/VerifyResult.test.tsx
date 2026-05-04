import { describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { VerifyResult } from './VerifyResult.js';

describe('<VerifyResult />', () => {
  it('shows a success card and auto-redirects after the delay', async () => {
    vi.useFakeTimers();
    try {
      const onRedirect = vi.fn();
      render(<VerifyResult status="success" onRedirect={onRedirect} delayMs={2000} />);

      expect(screen.getByText(/signed in/i)).toBeInTheDocument();
      expect(onRedirect).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      expect(onRedirect).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows an error card with the reason and a retry link', () => {
    render(<VerifyResult status="error" reason="expired" retryHref="/login" />);
    expect(screen.getByText(/link expired/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /request a new one/i })).toHaveAttribute(
      'href',
      '/login',
    );
  });

  it('handles unknown reasons with a fallback message', () => {
    render(<VerifyResult status="error" reason="some_weird_thing" retryHref="/login" />);
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });

  it('falls back to window.location.assign when no onRedirect is provided', async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, assign },
    });

    vi.useFakeTimers();
    try {
      render(<VerifyResult status="success" delayMs={500} redirectTo="/" />);
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(assign).toHaveBeenCalledWith('/');
    } finally {
      vi.useRealTimers();
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });
});
