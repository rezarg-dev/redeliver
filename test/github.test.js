import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sign, verifySignature } from '../src/signature.js';
import { createTestApp } from './support/helpers.js';

test('github scheme verifies the documented example', () => {
  // Values from GitHub's "Validating webhook deliveries" documentation.
  const secret = "It's a Secret to Everybody";
  const body = Buffer.from('Hello, World!');
  const headers = {
    'x-hub-signature-256': 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17',
  };
  assert.equal(verifySignature('github', secret, headers, body), true);
});

test('github scheme insists on the sha256= prefix and its own header', () => {
  const secret = 'whsec_test';
  const body = Buffer.from('{}');
  const digest = sign(secret, body);

  assert.equal(verifySignature('github', secret, { 'x-hub-signature-256': digest }, body), false);
  assert.equal(verifySignature('github', secret, { 'x-signature': `sha256=${digest}` }, body), false);
});

test('X-GitHub-Delivery is used as the idempotency key', async () => {
  const { app, store } = createTestApp();
  const source = store.sources.create({ name: 'repo', scheme: 'github' });
  const payload = '{"zen":"Keep it logically awesome."}';

  const deliver = () =>
    app.inject({
      method: 'POST',
      url: `/in/${source.id}`,
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'ping',
        'x-github-delivery': '72d3162e-cc78-11e3-81ab-4c9367dc0958',
        'x-hub-signature-256': `sha256=${sign(source.secret, payload)}`,
      },
      payload,
    });

  const first = await deliver();
  assert.equal(first.statusCode, 202);

  const redelivery = await deliver();
  assert.equal(redelivery.statusCode, 200);
  assert.equal(redelivery.json().duplicate, true);

  const headers = JSON.parse(store.events.get(first.json().id).headers);
  assert.equal(headers['x-github-event'], 'ping');
});
