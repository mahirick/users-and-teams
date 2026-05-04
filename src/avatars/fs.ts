// Filesystem AvatarStore — writes uploaded bytes to a directory on disk.
// The consumer is responsible for serving that directory via HTTP (e.g.
// @fastify/static) and passing the corresponding URL prefix here.

import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AvatarStore } from './types.js';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface FsAvatarStoreOptions {
  /** Local directory to write avatars into. Created if it doesn't exist. */
  baseDir: string;
  /** Public URL prefix mapped to `baseDir` (no trailing slash). E.g. "/avatars". */
  urlPrefix: string;
}

export function createFsAvatarStore(opts: FsAvatarStoreOptions): AvatarStore {
  const baseDir = resolve(opts.baseDir);
  const urlPrefix = opts.urlPrefix.replace(/\/$/, '');
  mkdirSync(baseDir, { recursive: true });

  // Keys may contain a path segment ("users/abc") — preserve it on disk.
  function diskPath(key: string, ext: string): string {
    const safe = key.replace(/[^a-zA-Z0-9_/-]/g, '_');
    const dir = resolve(baseDir, safe.split('/').slice(0, -1).join('/'));
    mkdirSync(dir, { recursive: true });
    const filename = `${safe.split('/').pop()}.${ext}`;
    return join(dir, filename);
  }

  return {
    async put({ key, bytes, contentType }) {
      const ext = EXT_BY_MIME[contentType];
      if (!ext) throw new Error(`Unsupported avatar content type: ${contentType}`);

      // Wipe any existing avatars for this key with a different extension
      // (so jpg → png replacement doesn't leak the old file).
      for (const oldExt of Object.values(EXT_BY_MIME)) {
        if (oldExt === ext) continue;
        try {
          unlinkSync(diskPath(key, oldExt));
        } catch {
          /* ignore */
        }
      }

      const filePath = diskPath(key, ext);
      writeFileSync(filePath, bytes);
      // Cache-bust on every write so the browser sees the new image.
      const v = Date.now();
      return { url: `${urlPrefix}/${key}.${ext}?v=${v}` };
    },

    async delete(key) {
      for (const ext of Object.values(EXT_BY_MIME)) {
        try {
          unlinkSync(diskPath(key, ext));
        } catch {
          /* ignore — already gone */
        }
      }
    },
  };
}
