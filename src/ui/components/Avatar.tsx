// Avatar: round monogram tile with white text on a deterministic color. Apple
// Contacts-style. Pre-computed initials/color come from the package, so this is
// purely presentational — no derivation here.

export interface AvatarProps {
  initials: string;
  color: string;
  /** "sm" 24px, "md" 40px, "lg" 56px. Default md. */
  size?: 'sm' | 'md' | 'lg';
  /** A visible name to use as the alt-text / aria-label. */
  label?: string | null;
  className?: string;
}

export function Avatar({ initials, color, size = 'md', label, className }: AvatarProps) {
  const sizeClass = `uat-avatar--${size}`;
  const classes = ['uat-avatar', sizeClass, className].filter(Boolean).join(' ');
  return (
    <span
      className={classes}
      style={{ backgroundColor: color }}
      role="img"
      aria-label={label ?? initials}
    >
      <span className="uat-avatar__text" aria-hidden="true">{initials || '?'}</span>
    </span>
  );
}
