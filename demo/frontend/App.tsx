// Tiny hash-based router for the demo. Avoids react-router as a demo dep.
// Routes:
//   /            → Home
//   /login       → LoginPage
//   /verify-result → VerifyResultPage (reads ?status & ?reason from URL)

import { useEffect, useState } from 'react';
import {
  LoginForm,
  AccountMenu,
  VerifyResult,
  TeamSwitcher,
  TeamMembersList,
  InviteForm,
  AcceptInvite,
  AdminUsersTable,
  AuditLog,
  useTeams,
  useAuth,
  type TeamMembership,
} from '@mahirick/users-and-teams/react';

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
        {route === '/my-teams' && <TeamsPage />}
        {route === '/invites/accept' && <AcceptInvitePage />}
        {route === '/admin-panel' && <AdminPage />}
        {route === '/admin-panel/audit' && <AuditPage />}
        {route === '/' && <Home navigate={navigate} />}
        {route !== '/' &&
          route !== '/login' &&
          route !== '/verify-result' &&
          route !== '/my-teams' &&
          route !== '/invites/accept' &&
          route !== '/admin-panel' &&
          route !== '/admin-panel/audit' && <Home navigate={navigate} />}
      </main>
    </div>
  );
}

function Header() {
  const { user } = useAuth();
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <TeamSwitcher
          onSelect={(m: TeamMembership) => {
            window.history.pushState({}, '', `/my-teams?id=${m.team.id}`);
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
        />
        <a
          href="/my-teams"
          style={{ color: '#94a3b8', fontSize: 13, textDecoration: 'none' }}
        >
          Teams
        </a>
        {user?.role === 'admin' && (
          <a
            href="/admin-panel"
            style={{ color: '#94a3b8', fontSize: 13, textDecoration: 'none' }}
          >
            Admin
          </a>
        )}
        <AccountMenu signInHref="/login" />
      </div>
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

function TeamsPage() {
  const { teams, loading } = useTeams();
  const params = new URLSearchParams(window.location.search);
  const activeId = params.get('id') ?? teams[0]?.team.id;
  const active = teams.find((m) => m.team.id === activeId) ?? teams[0];

  if (loading) return <p style={{ color: '#94a3b8' }}>Loading…</p>;

  if (!active) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <h1 style={{ marginBottom: 16, fontWeight: 600 }}>Teams</h1>
        <p style={{ color: '#94a3b8' }}>
          You're not in any teams yet. Create one from the Teams switcher in the header.
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 4px', fontWeight: 600 }}>{active.team.name}</h1>
      <p style={{ margin: '0 0 24px', color: '#94a3b8', fontSize: 13 }}>
        /{active.team.slug} · you are <strong>{active.role}</strong>
      </p>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>Members</h2>
        <TeamMembersList teamId={active.team.id} />
      </section>

      {(active.role === 'owner' || active.role === 'admin') && (
        <section
          style={{
            background: '#14181b',
            border: '1px solid #2a3138',
            borderRadius: 10,
            padding: 16,
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>Invite a teammate</h2>
          <InviteForm teamId={active.team.id} />
        </section>
      )}
    </div>
  );
}

function AcceptInvitePage() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') ?? '';
  if (!token) {
    return (
      <div style={{ textAlign: 'center', color: '#94a3b8' }}>
        Missing invite token in URL.
      </div>
    );
  }
  return <AcceptInvite token={token} redirectTo="/my-teams" loginHref="/login" />;
}

function AdminPage() {
  const { user } = useAuth();
  if (!user) {
    return <p style={{ color: '#94a3b8' }}>Sign in.</p>;
  }
  if (user.role !== 'admin') {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <h1 style={{ marginBottom: 16, fontWeight: 600 }}>Admin</h1>
        <p style={{ color: '#f87171' }}>You don't have admin role on this app.</p>
      </div>
    );
  }
  return (
    <div style={{ maxWidth: 1024, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <h1 style={{ margin: 0, fontWeight: 600 }}>Admin · Users</h1>
        <a
          href="/admin-panel/audit"
          style={{ color: '#06b6d4', fontSize: 14, textDecoration: 'none' }}
        >
          View audit log →
        </a>
      </div>
      <AdminUsersTable />
    </div>
  );
}

function AuditPage() {
  return (
    <div style={{ maxWidth: 1024, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 24px', fontWeight: 600 }}>Audit log</h1>
      <AuditLog />
    </div>
  );
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
