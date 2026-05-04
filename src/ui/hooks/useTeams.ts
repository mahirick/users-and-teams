// Hook for the team list + create. Pairs with the teams plugin's /teams routes.

import { useCallback, useContext, useEffect, useState } from 'react';
import { useAuth } from '../provider.js';
import { ProviderConfigContext } from '../provider-internal.js';

export interface PublicTeam {
  id: string;
  name: string;
  nameNormalized: string;
  adminId: string;
  avatarColor: string;
  avatarInitials: string;
  createdAt: number;
}

export interface TeamMembership {
  team: PublicTeam;
  role: 'admin' | 'user';
}

export interface UseTeamsResult {
  teams: TeamMembership[];
  loading: boolean;
  refresh: () => Promise<void>;
  createTeam: (
    name: string,
  ) => Promise<{ ok: boolean; team?: PublicTeam; error?: string }>;
}

export function useTeams(): UseTeamsResult {
  const { user } = useAuth();
  const config = useContext(ProviderConfigContext);
  const [teams, setTeams] = useState<TeamMembership[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFn = config.fetch;
  const apiBase = config.apiBase;

  const refresh = useCallback(async () => {
    if (!user) {
      setTeams([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetchFn(`${apiBase}/teams`, { credentials: 'include' });
      if (res.ok) {
        const data = (await res.json()) as { teams: TeamMembership[] };
        setTeams(data.teams);
      } else {
        setTeams([]);
      }
    } finally {
      setLoading(false);
    }
  }, [apiBase, fetchFn, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createTeam = useCallback(
    async (name: string) => {
      const res = await fetchFn(`${apiBase}/teams`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.status === 201) {
        const data = (await res.json()) as { team: PublicTeam };
        await refresh();
        return { ok: true, team: data.team };
      }
      if (res.status === 409) return { ok: false, error: 'name_taken' };
      if (res.status === 400) return { ok: false, error: 'invalid_payload' };
      if (res.status === 401) return { ok: false, error: 'unauthenticated' };
      return { ok: false, error: 'unknown' };
    },
    [apiBase, fetchFn, refresh],
  );

  return { teams, loading, refresh, createTeam };
}
