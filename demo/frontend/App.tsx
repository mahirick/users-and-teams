// Tiny hash-based router for the demo. Avoids react-router as a demo dep.
// Routes:
//   /            → Home
//   /login       → LoginPage
//   /verify-result → VerifyResultPage (reads ?status & ?reason from URL)

import { useEffect, useState } from 'react';
import { LoginForm, AccountMenu, VerifyResult } from '@mahirick/users-and-teams/react';

function getRoute(): string {
  return window.location.pathname || '/';
}

function navigate(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function App() {
  const [route, setRoute] = useState(getRoute());

  useEffect(() => {
    const onChange = () => setRoute(getRoute());
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  }, []);

  return (
    <div style={{ minHeight: '100vh' }}>
      <Header />
      <main style={{ padding: '32px 24px' }}>
        {route === '/login' && <LoginPage />}
        {route === '/verify-result' && <VerifyResultPage />}
        {(route === '/' || (route !== '/login' && route !== '/verify-result')) && (
          <Home navigate={navigate} />
        )}
      </main>
    </div>
  );
}

function Header() {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 24px',
        borderBottom: '1px solid #1f2937',
      }}
    >
      <a href="/" style={{ color: '#06b6d4', fontWeight: 600, textDecoration: 'none' }}>
        users-and-teams demo
      </a>
      <AccountMenu signInHref="/login" />
    </header>
  );
}

function LoginPage() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 32 }}>
      <LoginForm siteName="the demo" />
    </div>
  );
}

function VerifyResultPage() {
  const params = new URLSearchParams(window.location.search);
  const status = (params.get('status') ?? 'success') as 'success' | 'error';
  const reason = params.get('reason') ?? undefined;
  const props: Parameters<typeof VerifyResult>[0] = {
    status,
    redirectTo: '/',
    retryHref: '/login',
  };
  if (reason !== undefined) props.reason = reason;
  return <VerifyResult {...props} />;
}

function Home({ navigate }: { navigate: (p: string) => void }) {
  const [hello, setHello] = useState<{ message: string; user: unknown } | null>(null);

  useEffect(() => {
    fetch('/api/hello', { credentials: 'include' })
      .then((r) => r.json())
      .then(setHello)
      .catch(() => setHello(null));
  }, []);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 16px', fontSize: 28, fontWeight: 600, letterSpacing: '-0.01em' }}>
        Demo home
      </h1>
      <p style={{ color: '#94a3b8', lineHeight: 1.5 }}>
        Sign in to test the auth flow. The backend logs the magic link to its terminal — copy and paste the
        URL into your browser.
      </p>
      <div
        style={{
          marginTop: 24,
          padding: 16,
          background: '#14181b',
          border: '1px solid #2a3138',
          borderRadius: 10,
        }}
      >
        <h2 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600 }}>Protected route response</h2>
        <pre
          style={{
            margin: 0,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 12,
            color: '#e2e8f0',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {hello ? JSON.stringify(hello, null, 2) : 'Loading…'}
        </pre>
      </div>
      <button
        type="button"
        onClick={() => navigate('/login')}
        style={{
          marginTop: 16,
          padding: '8px 14px',
          background: '#06b6d4',
          color: '#0b0e10',
          border: 'none',
          borderRadius: 6,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Go to /login
      </button>
    </div>
  );
}
