// AvatarUploader — pick or drop an image, see a circular preview, save or
// remove. Resizing / center-cropping / EXIF stripping happens client-side via
// canvas before we POST a base64 data URL. Server-side validation in
// `decodeAvatarDataUrl` guards against malformed input.
//
// Used by AccountMenu (current user) and TeamProfile (team admin).

import { useCallback, useEffect, useRef, useState } from 'react';
import { Avatar } from './Avatar.js';

export interface AvatarUploaderProps {
  /** Current avatar URL, if any. */
  currentUrl?: string | null;
  /** Initials fallback shown in the preview when there's no image. */
  initials: string;
  /** Color fallback shown in the preview when there's no image. */
  color: string;
  /** A human label for accessibility ("Alice", "Engineering"). */
  label?: string;
  /** Called when the user picks a new image. Implementation should POST it. */
  onUpload: (dataUrl: string) => Promise<{ ok: boolean; error?: string }>;
  /** Called when the user clicks "Remove". */
  onRemove: () => Promise<{ ok: boolean; error?: string }>;
  /** Maximum side length, in pixels, after resize. Default 512. */
  maxSize?: number;
  /** JPEG quality (0–1) when re-encoding. Default 0.85. */
  quality?: number;
  className?: string;
}

export function AvatarUploader({
  currentUrl,
  initials,
  color,
  label,
  onUpload,
  onRemove,
  maxSize = 512,
  quality = 0.85,
  className,
}: AvatarUploaderProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl ?? null);
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync external prop changes (e.g. after refresh)
  useEffect(() => {
    setPreviewUrl(currentUrl ?? null);
  }, [currentUrl]);

  const onFile = useCallback(
    async (file: File) => {
      setError(null);
      if (!file.type.startsWith('image/')) {
        setError('That file isn’t an image.');
        return;
      }
      try {
        const processed = await resizeAndCrop(file, maxSize, quality);
        setPending(processed);
      } catch {
        setError('Could not read that image.');
      }
    },
    [maxSize, quality],
  );

  return (
    <div
      className={className}
      onDragEnter={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setHover(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        setHover(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void onFile(file);
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: 12,
        border: `1px dashed ${hover ? 'var(--uat-accent)' : 'var(--uat-border-light)'}`,
        borderRadius: 12,
        background: hover ? 'rgba(6, 182, 212, 0.06)' : 'transparent',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      <div style={{ position: 'relative', flexShrink: 0 }}>
        {pending ? (
          <img
            src={pending}
            alt="preview"
            className="uat-avatar uat-avatar--lg"
            style={{ width: 72, height: 72 }}
          />
        ) : (
          <Avatar
            initials={initials}
            color={color}
            url={previewUrl}
            size="lg"
            label={label}
            className="uat-avatar--xlarge"
          />
        )}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            bottom: -2,
            right: -2,
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: 'var(--uat-accent)',
            color: 'var(--uat-accent-fg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '2px solid var(--uat-bg-surface)',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 700,
          }}
          onClick={() => inputRef.current?.click()}
          title="Choose photo"
        >
          +
        </span>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFile(file);
            e.target.value = '';
          }}
        />
        <p style={{ margin: 0, fontSize: 13, color: 'var(--uat-text-primary)' }}>
          {pending ? 'Ready to upload' : previewUrl ? 'Photo set' : 'No photo set'}
        </p>
        <p style={{ margin: 0, fontSize: 11, color: 'var(--uat-text-muted)' }}>
          Drag &amp; drop, or click "+". JPEG, PNG, or WebP. Resized to {maxSize}px square.
        </p>
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          {pending && (
            <button
              type="button"
              className="uat-login__button"
              style={{ padding: '6px 14px', fontSize: 13 }}
              disabled={busy}
              onClick={async () => {
                if (busy) return;
                setBusy(true);
                setError(null);
                const res = await onUpload(pending);
                setBusy(false);
                if (res.ok) {
                  setPending(null);
                } else {
                  setError(res.error ?? 'Upload failed.');
                }
              }}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          )}
          {pending && (
            <button
              type="button"
              className="uat-account__menu-item"
              style={{ padding: '6px 12px', display: 'inline-block', width: 'auto', fontSize: 13 }}
              disabled={busy}
              onClick={() => setPending(null)}
            >
              Discard
            </button>
          )}
          {!pending && previewUrl && (
            <button
              type="button"
              className="uat-account__menu-item uat-account__menu-item--danger"
              style={{ padding: '6px 12px', display: 'inline-block', width: 'auto', fontSize: 13 }}
              disabled={busy}
              onClick={async () => {
                if (busy) return;
                if (!confirm('Remove this photo?')) return;
                setBusy(true);
                setError(null);
                const res = await onRemove();
                setBusy(false);
                if (res.ok) {
                  setPreviewUrl(null);
                } else {
                  setError(res.error ?? 'Could not remove photo.');
                }
              }}
            >
              Remove
            </button>
          )}
        </div>
        {error && (
          <p className="uat-login__error" role="alert" style={{ margin: 0, fontSize: 12 }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Read a File, resize so the longest side is `maxSize`, center-crop to a
 * square, and re-encode as JPEG with `quality`. Returns a base64 data URL.
 *
 * Re-encoding through canvas strips EXIF metadata as a side benefit.
 */
async function resizeAndCrop(file: File, maxSize: number, quality: number): Promise<string> {
  const dataUrl = await readAsDataUrl(file);
  const img = await loadImage(dataUrl);

  const side = Math.min(img.width, img.height);
  const sx = (img.width - side) / 2;
  const sy = (img.height - side) / 2;

  const target = Math.min(maxSize, side);
  const canvas = document.createElement('canvas');
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, side, side, 0, 0, target, target);

  return canvas.toDataURL('image/jpeg', quality);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
