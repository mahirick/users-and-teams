// Deterministic avatar derivation: given a name (or fallback email/id), compute
// up to 2 initials and pick a stable color from a small palette. No upload, no
// binary storage — Apple-style initials avatars are baked at write time and
// stored alongside the row.

const PALETTE = [
  '#E11D48', // rose
  '#F97316', // orange
  '#F59E0B', // amber
  '#16A34A', // green
  '#0D9488', // teal
  '#0EA5E9', // sky
  '#2563EB', // blue
  '#7C3AED', // violet
  '#C026D3', // fuchsia
  '#525252', // neutral
] as const;

/**
 * Derive 1–2 uppercase initials from a name, falling back to an email's local
 * part. Returns at most 2 ASCII letters/digits. Always non-empty (returns "?"
 * for inputs that yield nothing).
 */
export function deriveInitials(input: { displayName?: string | null; email?: string }): string {
  const fromName = pickInitials(input.displayName ?? '');
  if (fromName) return fromName;
  if (input.email) {
    const local = input.email.split('@')[0] ?? '';
    const fromLocal = pickInitials(local.replace(/[._-]+/g, ' '));
    if (fromLocal) return fromLocal;
  }
  return '?';
}

function pickInitials(raw: string): string {
  const cleaned = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const parts = cleaned.split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase().slice(0, 2);
}

/**
 * Stable color from id. Same id → same color across rebuilds and machines.
 * UUIDv7 ids are roughly time-sortable; we hash to spread across the palette.
 */
export function pickColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % PALETTE.length;
  return PALETTE[idx]!;
}

export const AVATAR_PALETTE: readonly string[] = PALETTE;

/**
 * Collapse all whitespace to single spaces, trim, and lowercase. Used as the
 * uniqueness key for team names — "Team Rocket" and "  team   rocket " collide.
 */
export function normalizeTeamName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}
