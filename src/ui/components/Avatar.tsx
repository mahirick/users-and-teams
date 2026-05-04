// Avatar: round monogram tile with white text on a deterministic color, or a
// user-uploaded photo when `url` is provided. Apple Contacts-style fallback.

export interface AvatarProps {
  initials: string;
  color: string;
  /** Optional uploaded photo URL — overrides initials when set. */
  url?: string | null;
  /** "sm" 24px, "md" 40px, "lg" 56px. Default md. */
  size?: 'sm' | 'md' | 'lg';
  /** A visible name to use as the alt-text / aria-label. */
  label?: string | null;
  className?: string;
}

export function Avatar({
  initials,
  color,
  url,
  size = 'md',
  label,
  className,
}: AvatarProps) {
  const sizeClass = `uat-avatar--${size}`;
  const classes = ['uat-avatar', sizeClass, className].filter(Boolean).join(' ');
  if (url) {
    return (
      <img
        className={classes}
        src={url}
        alt={label ?? initials}
        loading="lazy"
        decoding="async"
      />
    );
  }
  return (
    <span
      className={classes}
      style={{ backgroundColor: color }}
      role="img"
      aria-label={label ?? initials}
    >
      <span className="uat-avatar__text" aria-hidden="true">
        {initials || '?'}
      </span>
    </span>
  );
}
