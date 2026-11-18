# Architecture notes

This file explains the decisions behind redeliver that are not obvious from
reading the code, and what was given up for them.

## Accept first, deliver later

The ingest endpoint does three things and nothing else: verify the signature,
check the idempotency key, write the event and its deliveries. It never talks
to a destination. That keeps the answer to the sender fast and independent of
how the destinations are doing. Senders such as GitHub give up after ten
seconds, and a relay that makes them wait for a slow downstream service would
turn one problem into two.

The event and all of its deliveries are inserted in one transaction. There is
no moment in which an event exists without its deliveries, so nothing has to
be repaired after a crash. Either the sender got a `202` and everything is on
disk, or it got an error and will send again.

## SQLite as the queue

The `deliveries` table is the queue. A delivery is due when
`status = 'pending' AND next_attempt_at <= now`, and there is an index on
exactly those two columns.

A dedicated broker (Redis, RabbitMQ) would add a second system to run and,
more importantly, a second source of truth: the event in the database and the
job in the broker can disagree after a crash. With one SQLite file there is
one write, and it is atomic.

The price is that redeliver runs as a single instance. For a tool that sits in
front of a handful of services this is a fair trade. SQLite in WAL mode
handles far more writes per second than webhooks usually arrive with.

If this ever had to scale out, the store layer is the only place that knows
SQL. Moving to PostgreSQL would mean rewriting `src/store/` and replacing the
claim query with `SELECT ... FOR UPDATE SKIP LOCKED`.

## Claiming work

`claimDue()` selects the due deliveries and flips them to `in_progress` inside
one transaction, and increments `attempts` at the same time. Counting the
attempt when it starts, not when it ends, means a request that never returns
(because the process died) still counts.

On startup, anything still `in_progress` belongs to a process that no longer
exists and is put back to `pending`. Whether those requests reached their
destination is unknown, so they are sent again. This is the reason delivery
is at-least-once and why every request carries `X-Redeliver-Delivery`: a
destination that cares can remember the ids it has seen.

## Raw bodies

An HMAC signature covers bytes, not meaning. `{"a":1}` and `{"a": 1}` are the
same JSON and two different signatures. A framework that parses the body and
hands over an object has already thrown away what is needed to verify it.

The ingest routes therefore live in their own Fastify scope with all content
type parsers removed and a single catch-all that returns the body as a
`Buffer`. The admin API in the neighbouring scope keeps normal JSON parsing.
The stored body is a BLOB and is forwarded unchanged, so a destination can
verify the original sender's signature too if it has that secret.

## Backoff

Retry delays grow exponentially and are capped. Without randomness, a
destination that was down for an hour would get every delivery that failed in
that hour back at nearly the same instant, right when it is trying to
recover. The delay is therefore drawn at random from the upper half of the
current window ("equal jitter"): spread out, but never close to zero.

A `Retry-After` header raises the delay if it asks for more, and is capped at
`BACKOFF_MAX_MS` so that a misbehaving destination cannot postpone a delivery
indefinitely.

## Pausing

Pausing a destination does not touch its deliveries. The claim query joins
`destinations` and skips rows whose destination is disabled, so they stay
`pending` and go out as soon as it is enabled again. New events that arrive
while it is paused are not queued for it; use replay for those.

## Testing approach

Everything with a side effect is passed in: `buildApp()` receives the config
and the store, the worker receives `fetch`, `now` and `random`. Tests build
the whole application on an in-memory database and drive HTTP through
Fastify's `inject()`, so there are no ports and no network. Time-dependent
behaviour (backoff, `Retry-After`, the attempt limit) is tested by moving a
fake clock instead of waiting, so the whole suite runs in a few seconds.

## What is stored

| Table | Purpose |
| --- | --- |
| `sources` | Where webhooks come in: name, scheme, secret |
| `destinations` | Where they go: URL, optional secret, enabled flag |
| `events` | The webhook as received: forwarded headers, raw body, idempotency key |
| `deliveries` | One row per event and destination: status, attempt count, next attempt time |
| `delivery_attempts` | One row per request sent: status code, error, duration |

Deleting a source cascades through all of them.
