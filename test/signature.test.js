import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sign, verifySignature } from '../src/signature.js';

const secret = 'whsec_test';
const body = Buffer.from('{"order":42}');

test('sign matches a known HMAC-SHA256 vector', () => {
  // RFC 4231, test case 2
  assert.equal(
    sign('Jefe', 'what do ya want for nothing?'),
    '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
  );
});

test('hmac-sha256 accepts a correct signature', () => {
  const headers = { 'x-signature': sign(secret, body) };
  assert.equal(verifySignature('hmac-sha256', secret, headers, body), true);
});

test('hmac-sha256 accepts the sha256= prefix and upper case hex', () => {
  const digest = sign(secret, body);
  assert.equal(verifySignature('hmac-sha256', secret, { 'x-signature': `sha256=${digest}` }, body), true);
  assert.equal(verifySignature('hmac-sha256', secret, { 'x-signature': digest.toUpperCase() }, body), true);
});

test('hmac-sha256 rejects wrong, missing and malformed signatures', () => {
  const digest = sign(secret, body);
  const tampered = Buffer.from('{"order":43}');

  assert.equal(verifySignature('hmac-sha256', secret, { 'x-signature': digest }, tampered), false);
  assert.equal(verifySignature('hmac-sha256', 'other-secret', { 'x-signature': digest }, body), false);
  assert.equal(verifySignature('hmac-sha256', secret, {}, body), false);
  assert.equal(verifySignature('hmac-sha256', secret, { 'x-signature': '' }, body), false);
  assert.equal(verifySignature('hmac-sha256', secret, { 'x-signature': 'abc' }, body), false);
});

test('none accepts anything, unknown schemes accept nothing', () => {
  assert.equal(verifySignature('none', secret, {}, body), true);
  assert.equal(verifySignature('md5', secret, { 'x-signature': sign(secret, body) }, body), false);
});
