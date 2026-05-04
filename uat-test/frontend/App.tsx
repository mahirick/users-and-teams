// Tiny SPA exercising every package UI primitive in one app.
// Routes are pathname-based via window.history.

import { useEffect, useState } from 'react';
import {
  AccountMenu,
  AdminUsersTable,
  AcceptInvite,
  AuditLog,
  InviteForm,
  LoginForm,
  TeamMembersList,
  TeamSwitcher,
  VerifyResult,
  useAuth,
  useTeams,
  type TeamMembership,
} from '@mahirick/users-and-teams/react';

function getRoute(): string {
  return window.location.pathname || '/';
}

function navigate(p: string) {
  window.history.pushState({}, '', p);
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
        {route === '/' && <Home />}
        {route === '/login' && <LoginPage />}
        {route === '/verify-result' && <VerifyResultPage />}
        {route === '/my-teams' && <TeamsPage />}
        {route === '/invites/accept' && <AcceptInvitePage />}
        {route === '/admin-panel' && <AdminPage />}
        {route === '/admin-panel/audit' && <AuditPage />}
      </main>
      <footer style={{ padding: 24, color: '#64748b', fontSize: 12, textAlign: 'center' }}>
        uat-test — installed via <code>file:..</code> from
        <code> @mahirick/users-and-teams</code>
      </footer>
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
        uat-test
      </a>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {user && (
          <TeamSwitcher
            onSelect={(m: TeamMembership) =>
              navigate(`/my-teams?id=${m.team.id}`)
            }
          />
        )}
        {user && (
          <a href="/my-teams" style={linkStyle}>Teams</a>
        )}
        {user?.role === 'admin' && (
          <a href="/admin-panel" style={linkStyle}>Admin</a>
        )}
        <AccountMenu signInHref="/login" />
      </div>
    </header>
  );
}

function Home() {
  const [whoami, setWhoami] = useState<unknown>(null);
  useEffect(() => {
    fetch('/api/whoami', { credentials: 'include' })
      .then((r) => r.json())
      .then(setWhoami)
      .catch(() => {});
  }, []);
  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 12, fontWeight: 600, letterSpacing: '-0.01em' }}>
        UAT Test consumer
      </h1>
      <p style={{ color: '#94a3b8' }}>
        This app installed <code>@mahirick/users-and-teams</code> via a
        local <code>file:..</code> dependency, so it's a real consumer
        — not the in-repo demo's Vite alias. Edit the package, then in
        this directory run <code>npm run update</code> to rebuild + reinstall.
      </p>
      <pre style={preStyle}>{JSON.stringify(whoami, null, 2)}</pre>
    </div>
  );
}

function LoginPage() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 32 }}>
      <LoginForm siteName="UAT Test" />
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
  const id = params.get('id') ?? teams[0]?.team.id;
  const active = teams.find((m) => m.team.id === id) ?? teams[0];

  if (loading) return <p style={{ color: '#94a3b8' }}>Loading…</p>;
  if (!active)
    return (
      <p style={{ color: '#94a3b8' }}>
        Create a team from the switcher in the header.
      </p>
    );

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 4px', fontWeight: 600 }}>{active.team.name}</h1>
      <p style={{ margin: '0 0 24px', color: '#94a3b8', fontSize: 13 }}>
        /{active.team.slug} · you are <strong>{active.role}</strong>
      </p>
      <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>Members</h2>
      <TeamMembersList teamId={active.team.id} />
      {(active.role === 'owner' || active.role === 'admin') && (
        <section style={{ marginTop: 32, ...cardStyle }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>
            Invite a teammate
          </h2>
          <InviteForm teamId={active.team.id} />
        </section>
      )}
    </div>
  );
}

function AcceptInvitePage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  if (!token) return <p style={{ color: '#94a3b8' }}>Missing token.</p>;
  return <AcceptInvite token={token} redirectTo="/my-teams" loginHref="/login" />;
}

function AdminPage() {
  const { user } = useAuth();
  if (user?.role !== 'admin')
    return <p style={{ color: '#f87171' }}>Admins only.</p>;
  return (
    <div style={{ maxWidth: 1024, margin: '0 auto' }}>
      <div style={headerRowStyle}>
        <h1 style={{ margin: 0, fontWeight: 600 }}>Admin · Users</h1>
        <a href="/admin-panel/audit" style={{ color: '#06b6d4', fontSize: 14, textDecoration: 'none' }}>
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

const linkStyle: React.CSSProperties = {
  color: '#94a3b8',
  fontSize: 13,
  textDecoration: 'none',
};

const cardStyle: React.CSSProperties = {
  background: '#14181b',
  border: '1px solid #2a3138',
  borderRadius: 10,
  padding: 16,
};

const preStyle: React.CSSProperties = {
  ...cardStyle,
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 12,
  color: '#e2e8f0',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  marginTop: 16,
};

const headerRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  marginBottom: 24,
};
