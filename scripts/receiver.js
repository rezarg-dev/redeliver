#!/usr/bin/env node
// A throwaway webhook receiver for trying redeliver locally. Prints every
// request, and can pretend to be broken to show retries in action.
//
//   node scripts/receiver.js [--port 9000] [--fail 2] [--secret <secret>]
//
//   --fail N     answer the first N requests with 503
//   --secret S   verify X-Redeliver-Signature against S

import { createServer } from 'node:http';
import { parseArgs } from 'node:util';

import { sign } from '../src/signature.js';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '9000' },
    fail: { type: 'string', default: '0' },
    secret: { type: 'string' },
  },
});

let failuresLeft = Number(values.fail);

const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  const attempt = request.headers['x-redeliver-attempt'] ?? '-';
  const delivery = request.headers['x-redeliver-delivery'] ?? '-';
  let status = 200;
  let note = '';

  if (values.secret) {
    const expected = `sha256=${sign(values.secret, body)}`;
    if (request.headers['x-redeliver-signature'] !== expected) {
      status = 401;
      note = ' (bad signature)';
    }
  }
  if (status === 200 && failuresLeft > 0) {
    failuresLeft -= 1;
    status = 503;
    note = ' (simulated failure)';
  }

  const time = new Date().toISOString().slice(11, 23);
  console.log(`${time}  ${delivery}  attempt ${attempt}  ->  ${status}${note}  ${body.toString()}`);

  response.writeHead(status).end();
});

server.listen(Number(values.port), () => {
  console.log(`receiver listening on http://localhost:${values.port}`);
});
