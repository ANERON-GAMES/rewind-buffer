# rewind-buffer

## Purpose

Rewind entity positions to a past server time for a hit check.

Each entity keeps a bounded ring of snapshots. A snapshot is an id, a server time, a position, and optional extra state. Given a past server time, the buffer returns every entity's position at that time by interpolating the two snapshots that bracket it. A time outside an entity's stored samples clamps to the nearest stored sample. The buffer does not invent a path beyond the samples it holds.

`checkHit` runs a caller-supplied hit callback against that rewound world. A query older than the configured max-rewind limit does not run the callback. Rewind itself still returns the stored positions, so inspection is not an accepted hit.

Callers supply server time. The module does not read a clock, open a socket, or start a timer. It has no runtime dependencies.

## Install

The package is an ES module. It needs Node.js 20 or newer. It has no runtime dependencies. The package name is `@aneron/rewind-buffer`. It is not published to the npm registry.

Clone this repository and run the tests:

```bash
git clone https://github.com/ANERON-GAMES/rewind-buffer.git
cd rewind-buffer
npm install
npm test
```

`npm test` runs `node --test`. `npm run lint` runs ESLint. `npm run format:check` runs Prettier.

Install it as a dependency from the git repository:

```bash
npm install github:ANERON-GAMES/rewind-buffer
```

```js
import { checkHit, createBuffer, record, rewind } from "@aneron/rewind-buffer";
```

Code in this repository imports the same entry point with `./src/index.js`.

## Usage

Server time here is a number in the caller's unit. With the default max rewind of `1000`, a caller that stores milliseconds can look back one second. This sample uses a shorter limit so the refusal is easy to see.

```js
import { checkHit, createBuffer, record, rewind } from "@aneron/rewind-buffer";

let history = createBuffer({ capacity: 8, maxRewind: 50 });

history = record(history, {
  id: "a",
  time: 1000,
  position: { x: 0, y: 0 },
  state: { pose: "run" }
});
history = record(history, {
  id: "a",
  time: 1100,
  position: { x: 10, y: 0 },
  state: { pose: "run" }
});
history = record(history, {
  id: "b",
  time: 1100,
  position: { x: 4, y: 4 }
});

const world = rewind(history, 1050);

const hit = checkHit(history, 1050, (rewound) => {
  const target = rewound.entities.find((entity) => entity.id === "a");
  return target.position.x === 5;
});

const rejected = checkHit(history, 1000, () => true);
const inspected = rewind(history, 1000);
```

`record` returns a new buffer. `history` after the three calls holds two snapshots for `"a"` and one for `"b"`. `world.latestTime` is `1100`. `world.limited` is `false`. `world.entities[0]` is `"a"` at `{ x: 5, y: 0, z: 0 }` with `alpha` `0.5` and the state `{ pose: "run" }`. `world.entities[1]` is `"b"`, clamped to its only sample at time `1100`, position `{ x: 4, y: 4, z: 0 }`.

`hit.accepted` is `true` and `hit.result` is `true`. The midpoint of `"a"` is inside the 50 unit limit (`1100 - 50` is `1050`).

`rejected.accepted` is `false`, `rejected.limited` is `true`, and `rejected.result` is `null`. The callback is not called. Time `1000` is older than `1050`. `inspected.limited` is `true`, and `inspected.entities[0].position.x` is `0`. Rewind still returns the real sample at time `1000`. The limit refuses the hit. It does not move the inspected position up to the limit.

## API

All functions are deterministic. They do not read the clock, the network, or the filesystem. They do not mutate their arguments. `record` and a `forget` that removes an id return a new buffer. A `forget` of an id that is not present returns the same buffer.

Server time and `maxRewind` share one unit. The module does not convert milliseconds, ticks, or seconds.

### Constants

| Export               | Value  | Meaning                                                                                |
| -------------------- | ------ | -------------------------------------------------------------------------------------- |
| `DEFAULT_CAPACITY`   | `64`   | Snapshots kept for one entity when `createBuffer` is called without `capacity`.        |
| `DEFAULT_MAX_REWIND` | `1000` | Largest age, before `latestTime`, that `checkHit` will still run. Same unit as `time`. |

### Buffer

| Field        | Type             | Meaning                                                                                        |
| ------------ | ---------------- | ---------------------------------------------------------------------------------------------- |
| `capacity`   | number           | Maximum snapshots stored for each entity. A positive integer.                                  |
| `maxRewind`  | number           | Maximum age `checkHit` accepts, measured back from `latestTime`. A non-negative finite number. |
| `latestTime` | number or `null` | Newest snapshot time in the buffer, or `null` when it holds no snapshots.                      |
| `entities`   | object           | Own properties are entity ids. The object's prototype is `null`.                               |

Each entity value is `{ id, snapshots }`. `snapshots` is chronological, oldest first. Each snapshot is `{ time, position, state }`. `position` is `{ x, y, z }`. `state` is the stored extra value, or `null` when the caller omitted it.

Do not mutate a returned buffer. `record` shares the entity record of every id it did not write. `state` is stored by reference. Positions are copied.

### Snapshot

The object passed to `record`.

| Field      | Type   | Role                                                                                       |
| ---------- | ------ | ------------------------------------------------------------------------------------------ |
| `id`       | string | Entity id. A non-empty string. `"__proto__"`, `"constructor"`, and `"toString"` are valid. |
| `time`     | number | Server time. A finite number. A later `record` for the same id must be greater or equal.   |
| `position` | object | `{ x, y, z }`. `x` and `y` are required finite numbers. A missing `z` is stored as `0`.    |
| `state`    | any    | Optional. Omitted and `undefined` are stored as `null`. Every other value is kept as-is.   |

Extra fields on the snapshot and on the position are ignored. They are not copied into the buffer.

### `createBuffer(options)`

Return a new empty buffer.

| Argument  | Type   | Role                                                                                        |
| --------- | ------ | ------------------------------------------------------------------------------------------- |
| `options` | object | Optional. Omitted and `undefined` become `{}`. `null`, an array, and any other value throw. |

| Field       | Type   | Role                                                                  |
| ----------- | ------ | --------------------------------------------------------------------- |
| `capacity`  | number | Snapshots per entity. Omitted or `undefined` uses `DEFAULT_CAPACITY`. |
| `maxRewind` | number | Hit-check limit. Omitted or `undefined` uses `DEFAULT_MAX_REWIND`.    |

`capacity` must be an integer greater than or equal to `1`. `maxRewind` must be a finite number greater than or equal to `0`. `0` means `checkHit` accepts only `latestTime` and times ahead of it. Any other `capacity` or `maxRewind`, including `null`, throws `TypeError`. Unknown fields are ignored.

`createBuffer()` is `{ capacity: 64, maxRewind: 1000, latestTime: null, entities }` with an empty null-prototype map. Each call returns new objects.

### `record(buffer, snapshot)`

Append one snapshot and return the next buffer.

`buffer` must be a buffer, including one produced by an earlier `record` or `forget`. `snapshot` must be a snapshot. A bad buffer throws before the snapshot is read. A bad snapshot throws `TypeError` with one of these messages:

| Message                                       | Cause                                                                                         |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `snapshot must be an object`                  | `null`, an array, or any non-object.                                                          |
| `snapshot id must be a non-empty string`      | Missing, empty, or not a string. Numeric ids are rejected.                                    |
| `snapshot time must be a finite number`       | Missing, `NaN`, `Infinity`, or not a number.                                                  |
| `snapshot position must be an object`         | Missing, `null`, or an array.                                                                 |
| `position x, y, and z must be finite numbers` | A coordinate is missing (other than `z`), non-finite, or not a number. `z: null` is rejected. |

A time older than that entity's newest snapshot throws `RangeError` with the message `snapshot time must not move backwards`. The previous buffer is unchanged. Shape checks run first, so a bad position on a backwards sample throws `TypeError`.

A time equal to that entity's newest snapshot replaces the newest snapshot. The ring length does not change, and an older snapshot is not dropped.

A greater time appends. When the entity already holds `capacity` snapshots, the oldest is dropped and then the new snapshot is appended. Capacity `1` therefore keeps only the newest sample.

Other entities are unchanged and keep the same entity record. `latestTime` becomes the greater of the previous `latestTime` and the written time. The first snapshot sets `latestTime` to that time. Entities do not have to share one time base: a sample at time `3` may be recorded after another entity's sample at time `5`. `latestTime` stays `5`.

The returned position is a new object. Later writes to the caller's position do not change the buffer. `state` is the same reference the caller passed, except that a missing or `undefined` state is `null`.

### `forget(buffer, id)`

Drop one entity and return a buffer.

`id` must be a non-empty string. Any other id throws `TypeError`. An id that is not present returns the same buffer reference. A present id returns a new buffer. `latestTime` is recomputed from the entities that remain, or `null` when none remain. The kept entity records are the same objects as in `buffer`.

### `rewind(buffer, time)`

Return every entity's position at `time`.

`time` must be a finite number. Any other value throws `TypeError`. The buffer is not modified.

The return value:

| Field        | Type             | Meaning                                                                              |
| ------------ | ---------------- | ------------------------------------------------------------------------------------ |
| `time`       | number           | The requested time, unchanged.                                                       |
| `latestTime` | number or `null` | The buffer's newest snapshot time.                                                   |
| `limited`    | boolean          | `true` when `latestTime` is not `null` and `time < latestTime - maxRewind`.          |
| `ahead`      | boolean          | `true` when `latestTime` is not `null` and `time > latestTime`.                      |
| `entities`   | array            | One rewound entity per stored entity, sorted by id with the default string ordering. |

`limited` and `ahead` do not change `time` and do not change positions. A time equal to `latestTime - maxRewind` is not limited. A time equal to `latestTime` is not ahead. An empty buffer has `limited` `false`, `ahead` `false`, `latestTime` `null`, and `entities` `[]`. The comparison is ordinary IEEE subtraction. There is no epsilon.

Comparison of two ids uses UTF-16 code unit order. `"a"` sorts before `"a10"`, and `"a10"` sorts before `"a2"`.

Each item of `entities`:

| Field      | Type    | Meaning                                                                                                          |
| ---------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `id`       | string  | The entity id.                                                                                                   |
| `position` | object  | `{ x, y, z }` at this query. A new object on every call.                                                         |
| `state`    | any     | The state of the snapshot the query landed on, or of the earlier snapshot when the query is between two.         |
| `alpha`    | number  | `0` when one snapshot was used. Otherwise the blend weight of the newer snapshot, in the open interval `(0, 1)`. |
| `clamped`  | boolean | `true` when `time` is strictly outside that entity's oldest and newest snapshot times.                           |
| `fromTime` | number  | The earlier snapshot time. Equal to `toTime` when one snapshot was used.                                         |
| `toTime`   | number  | The later snapshot time.                                                                                         |

For one entity, the first match wins:

1. `time` is below the oldest snapshot: use that snapshot. `clamped` is `true`. `alpha` is `0`.
2. `time` is above the newest snapshot: use that snapshot. `clamped` is `true`. `alpha` is `0`.
3. `time` equals a snapshot: use that snapshot. `clamped` is `false`. `alpha` is `0`. `state` is that snapshot's state.
4. Otherwise `time` lies strictly between two adjacent snapshots. `clamped` is `false`. `state` is the earlier snapshot's state.

The blend in step 4 is:

```
alpha = (time - fromTime) / (toTime - fromTime)
x = fromX + (toX - fromX) * alpha
```

`y` and `z` use the same weight. No other curve is applied. A query is not extrapolated past either end of the ring, and it is not pulled forward to `latestTime - maxRewind`.

An entity with a shorter ring clamps on its own. A query that is legal for the buffer can still return `clamped: true` for an entity whose oldest sample is newer than `time`, or whose newest sample is older than `time`. That entity stays in the array.

`position = from + (to - from) * alpha` also holds for a single snapshot, because `fromTime === toTime` and `alpha` is `0`.

### `checkHit(buffer, time, hit)`

Run `hit` against the rewound world when the query is allowed.

| Argument | Type     | Role                                                                              |
| -------- | -------- | --------------------------------------------------------------------------------- |
| `buffer` | object   | A buffer.                                                                         |
| `time`   | number   | The server time to rewind to.                                                     |
| `hit`    | function | Called as `hit(world)` with the object `rewind` would return. Its return is kept. |

`buffer` and `time` are validated first, by rewinding. `hit` is validated after that. A non-function `hit` throws `TypeError` with the message `hit must be a function`, including when the buffer is empty and including when the query is past the limit. A bad `time` throws before that, even if `hit` is also unusable.

The return value:

| Field        | Type             | Meaning                                                                             |
| ------------ | ---------------- | ----------------------------------------------------------------------------------- |
| `accepted`   | boolean          | `true` only when `hit` was called.                                                  |
| `limited`    | boolean          | `true` when the query is older than the max-rewind limit.                           |
| `ahead`      | boolean          | Copied from the world when the hit runs. `false` when it does not.                  |
| `time`       | number or `null` | The requested time, or `null` when the buffer has no snapshots.                     |
| `latestTime` | number or `null` | The buffer's newest time, or `null` when it has no snapshots.                       |
| `result`     | any              | The return value of `hit`, including `undefined`. `null` when `hit` was not called. |

The checks run in this order. The first match wins.

1. The buffer has no snapshots: `hit` is not called. `accepted` is `false`, `time` is `null`, and `result` is `null`.
2. `rewind` reports `limited`: `hit` is not called. `accepted` is `false`, `result` is `null`, and `time` is the requested time.
3. Otherwise `hit(world)` is called once. `accepted` is `true`. This includes a time ahead of `latestTime`. Every entity is then clamped to its newest snapshot, and `ahead` is `true`. It also includes a time inside the limit at which some entity is clamped to its own ring.

An exception thrown by `hit` propagates. The buffer is unchanged either way. The world object is new. Mutating it does not change the buffer. `state` inside that world is still the stored reference.

`result` is `null` both when the hit was refused and when an accepted callback returns `null`. `accepted` distinguishes those cases. A callback that returns `undefined` is accepted, and `result` is `undefined`.

### Errors on a malformed buffer

`record`, `forget`, `rewind`, and `checkHit` validate the buffer they receive. A buffer returned by this module passes. A buffer that has been mutated, or built by hand with a broken shape, throws:

| Message                                                 | Error        | Cause                                                                           |
| ------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------- |
| `buffer must be an object`                              | `TypeError`  | `null`, an array, or any non-object.                                            |
| `capacity must be a positive integer`                   | `TypeError`  | `capacity` is missing or not an integer of `1` or more.                         |
| `maxRewind must be a non-negative finite number`        | `TypeError`  | `maxRewind` is missing, negative, or not a finite number.                       |
| `buffer latestTime must be a finite number or null`     | `TypeError`  | `latestTime` is not `null`, `undefined`, or a finite number.                    |
| `buffer entities must be an object`                     | `TypeError`  | `entities` is missing, an array, or any non-object.                             |
| `entity must be an object`                              | `TypeError`  | A stored entity is not an object.                                               |
| `entity id must match its key`                          | `TypeError`  | `entities[id].id` is not `id`.                                                  |
| `entity snapshots must be a non-empty array`            | `TypeError`  | `snapshots` is missing, empty, or not an array.                                 |
| `entity history exceeds capacity`                       | `RangeError` | More snapshots are stored than `capacity`.                                      |
| `snapshot times must increase`                          | `RangeError` | Two stored times are equal or out of order. `record` does not write this shape. |
| `buffer latestTime does not match the stored snapshots` | `TypeError`  | `latestTime` is not the max newest time, or is set while the map is empty.      |

## Design

The ring is per entity because entities are not sampled on one shared clock. One entity can be recorded on every tick while another is recorded once. A single global array would drop the quiet entity or keep the busy one without a bound. Each ring stops at `capacity`. When a newer time arrives and the ring is full, the oldest snapshot for that entity is dropped. Memory stays bounded by `capacity` times the number of entities the caller still holds. `forget` is how an id leaves. Until then, its ring remains.

Equal server times replace the newest snapshot instead of pushing a duplicate. A repeated sample at the same time must not consume the ring. A time that moves backwards is refused. The stored times stay strictly increasing, which is what the bracket search assumes. The search is a binary search over that ordered ring. It selects the same pair a linear walk would select.

Interpolation is linear in server time, one axis at a time. Between two samples the position moves at constant velocity. The weight is `(time - fromTime) / (toTime - fromTime)`. There is no spline and no extrapolation. A query before the oldest sample, or after the newest, uses that end sample and sets `clamped`. Extrapolation would report a position the snapshots do not contain. Clamping reports a stored position and says so.

`state` is not blended. Health, a pose name, or any other extra value is not a coordinate. Inside an open interval the state is the earlier snapshot's state, so a value that changes at time `t` is not visible before `t`. At exactly `t` the state is the snapshot recorded at `t`. At a clamped end, the state is that end snapshot's state.

The max-rewind limit is a refusal, not a second clamp. The ring may hold samples older than the limit. `rewind` at such a time still returns those samples, or the window clamp if the time is also outside the ring, and it sets `limited`. `checkHit` does not call the callback. Pulling every position forward to `latestTime - maxRewind` would hide the sample that was actually stored. Refusing the callback means a query past the limit cannot come back as an accepted hit. A time exactly at `latestTime - maxRewind` is inside the limit and runs.

A time ahead of `latestTime` is different. The buffer has no later sample to refuse in favor of. `checkHit` runs, `ahead` is `true`, and each entity clamps to its own newest snapshot. A caller that wants to ignore a clamped entity reads `clamped`. The module still includes the entity. Leaving it out would drop something that has a known position.

`latestTime` is the maximum newest snapshot time across entities. The limit is measured from that value, not from the newest time of each entity. An entity that stopped receiving samples can be clamped at a legal query time. That is the shorter-history case above.

Returned buffers are values. `record` copies the position it stores and copies the snapshots of the entity it writes, so a later edit to the input position or to the previous buffer's snapshot objects does not cross versions. Entity records that were not written are shared, which keeps an untouched ring intact without a second copy. `state` is shared on purpose. A caller that mutates a state object mutates every buffer version that stored that reference. Treat state as immutable, or pass a new value on the next `record`.

`rewind` copies the position it returns. The entity list is a new array in sorted id order, so two calls with the same buffer and the same time are deep-equal. Sorting is lexicographic so the order does not depend on insertion order. The arithmetic is IEEE-754 with no epsilon and no random term. The same inputs produce the same outputs.

This module does not open sockets, read the clock, schedule timers, or assign ids. The caller chooses the time unit, which entities to record, and what a hit means. The callback receives the rewound world and returns whatever the caller needs. The module does not interpret that return value.

## License

Released under the MIT License. The full text is in [LICENSE](LICENSE).
