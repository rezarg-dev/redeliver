#!/usr/bin/env node
// Sends a signed test webhook to a redeliver source.
//
//   node scripts/send.js <ingest-url> <secret> [json-body] [--key <idempotency-key>]
//
//   node scripts/send.js http://localhost:3000/in/src_abc whsec_xyz '{"order":42}'

import { parseArgs } from 'node:util';

import { sign } from '../src/signature.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { key: { type: 'string' } },
});
const [url, secret, body = '{"hello":"world"}'] = positionals;

if (!url || !secret) {
  console.error('Usage: node scripts/send.js <ingest-url> <secret> [json-body] [--key <idempotency-key>]');
  process.exit(1);
}

const headers = {
  'content-type': 'application/json',
  'x-signature': `sha256=${sign(secret, body)}`,
};
if (values.key) headers['idempotency-key'] = values.key;

try {
  const response = await fetch(url, { method: 'POST', headers, body });
  console.log(response.status, await response.text());
  process.exitCode = response.ok ? 0 : 1;
} catch (err) {
  console.error(`Request failed: ${err.cause?.code ?? err.message}`);
  process.exitCode = 1;
}
