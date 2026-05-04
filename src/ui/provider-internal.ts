// Internal context shared between provider and hooks. Holds the resolved
// fetch + apiBase so hooks like useTeams can issue requests without
// re-resolving them every render.

import { createContext } from 'react';

export interface ProviderConfig {
  apiBase: string;
  fetch: typeof fetch;
}

export const ProviderConfigContext = createContext<ProviderConfig>({
  apiBase: '',
  fetch: globalThis.fetch?.bind(globalThis) ?? (() => Promise.reject(new Error('fetch missing'))),
});
