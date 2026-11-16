import { randomBytes } from 'node:crypto';

// Prefixed ids (src_..., evt_...) make logs and API responses easier to read
// than bare UUIDs: you can tell what an id refers to without context.
export function newId(prefix) {
  return `${prefix}_${randomBytes(12).toString('base64url')}`;
}

export function newSecret() {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}
