// Avatar storage abstraction. Consumers either accept the default
// `createFsAvatarStore` (writes to disk on the consumer's host) or implement
// this interface to point at S3 / R2 / GCS / a CDN.

export interface AvatarStoreInput {
  /** Stable key per subject — `users/<id>` or `teams/<id>`. The store appends
   * an extension based on `contentType` and is responsible for cache-busting. */
  key: string;
  /** Image bytes — already validated and (ideally) re-encoded by the caller. */
  bytes: Buffer;
  /** Source content type (`image/jpeg` | `image/png` | `image/webp`). */
  contentType: string;
}

export interface AvatarStorePutResult {
  /** Public URL the browser will load from `<img src>`. */
  url: string;
}

export interface AvatarStore {
  put(input: AvatarStoreInput): Promise<AvatarStorePutResult>;
  delete(key: string): Promise<void>;
}

export const ALLOWED_AVATAR_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const MAX_AVATAR_BYTES = 1_500_000; // ~1.5MB after client-side resize
