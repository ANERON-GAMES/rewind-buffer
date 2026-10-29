import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CAPACITY,
  DEFAULT_MAX_REWIND,
  createBuffer,
  forget,
  record
} from "../src/index.js";

function snapshot(id, time, position, state) {
  const value = { id, time, position };
  if (arguments.length > 3) {
    value.state = state;
  }
  return value;
}

test("createBuffer uses a capacity of 64 and a max rewind of 1000", () => {
  const buffer = createBuffer();
  assert.equal(DEFAULT_CAPACITY, 64);
  assert.equal(DEFAULT_MAX_REWIND, 1000);
  assert.deepEqual(
    { ...buffer, entities: {} },
    {
      capacity: 64,
      maxRewind: 1000,
      latestTime: null,
      entities: {}
    }
  );
  assert.equal(Object.getPrototypeOf(buffer.entities), null);
  assert.deepEqual(Object.keys(buffer.entities), []);
});

test("createBuffer reads capacity and maxRewind and ignores other fields", () => {
  const buffer = createBuffer({ capacity: 4, maxRewind: 25, label: "ignored" });
  assert.equal(buffer.capacity, 4);
  assert.equal(buffer.maxRewind, 25);
  assert.equal(buffer.latestTime, null);
  assert.equal(Object.hasOwn(buffer, "label"), false);
});

test("each buffer is a new entity map", () => {
  const first = createBuffer();
  const second = createBuffer();
  const recorded = record(first, snapshot("a", 1, { x: 1, y: 2 }));
  assert.equal(Object.keys(second.entities).length, 0);
  assert.equal(Object.keys(first.entities).length, 0);
  assert.equal(recorded.entities.a.snapshots.length, 1);
});

test("createBuffer rejects a bad options object, capacity, or maxRewind", () => {
  assert.throws(() => createBuffer(null), {
    name: "TypeError",
    message: "options must be an object"
  });
  assert.throws(() => createBuffer([]), TypeError);
  assert.throws(() => createBuffer("options"), TypeError);
  assert.throws(() => createBuffer({ capacity: 0 }), {
    name: "TypeError",
    message: "capacity must be a positive integer"
  });
  assert.throws(() => createBuffer({ capacity: -1 }), TypeError);
  assert.throws(() => createBuffer({ capacity: 1.5 }), TypeError);
  assert.throws(() => createBuffer({ capacity: Number.NaN }), TypeError);
  assert.throws(() => createBuffer({ capacity: Number.POSITIVE_INFINITY }), TypeError);
  assert.throws(() => createBuffer({ capacity: "8" }), TypeError);
  assert.throws(() => createBuffer({ capacity: null }), TypeError);
  assert.throws(() => createBuffer({ maxRewind: -0.1 }), {
    name: "TypeError",
    message: "maxRewind must be a non-negative finite number"
  });
  assert.throws(() => createBuffer({ maxRewind: Number.NaN }), TypeError);
  assert.throws(() => createBuffer({ maxRewind: Number.POSITIVE_INFINITY }), TypeError);
  assert.throws(() => createBuffer({ maxRewind: "1000" }), TypeError);
  assert.throws(() => createBuffer({ maxRewind: null }), TypeError);
});

test("omitted settings use the defaults, including an explicit undefined", () => {
  const buffer = createBuffer({ capacity: undefined, maxRewind: undefined });
  assert.equal(buffer.capacity, DEFAULT_CAPACITY);
  assert.equal(buffer.maxRewind, DEFAULT_MAX_REWIND);
});

test("record stores a copy of the position and the state reference", () => {
  const state = { pose: "run" };
  const position = { x: 1, y: 2, z: 3, w: 9 };
  const input = snapshot("a", 10, position, state);
  input.note = "ignored";
  const buffer = record(createBuffer(), input);
  input.time = 99;
  position.x = 50;
  state.pose = "idle";

  assert.deepEqual(buffer.entities.a, {
    id: "a",
    snapshots: [
      {
        time: 10,
        position: { x: 1, y: 2, z: 3 },
        state
      }
    ]
  });
  assert.equal(buffer.entities.a.snapshots[0].state, state);
  assert.equal(buffer.entities.a.snapshots[0].state.pose, "idle");
  assert.equal(buffer.latestTime, 10);
  assert.equal(Object.getPrototypeOf(buffer.entities), null);
  assert.notEqual(buffer.entities.a.snapshots[0].position, position);
});

test("a missing z is 0 and a missing state is null", () => {
  const buffer = record(createBuffer(), {
    id: "a",
    time: 1,
    position: { x: 4, y: 5 }
  });
  assert.deepEqual(buffer.entities.a.snapshots[0].position, { x: 4, y: 5, z: 0 });
  assert.equal(buffer.entities.a.snapshots[0].state, null);
});

test("undefined state is stored as null, and false, zero, and null are kept", () => {
  const base = createBuffer();
  assert.equal(
    record(base, snapshot("a", 1, { x: 0, y: 0 }, undefined)).entities.a.snapshots[0].state,
    null
  );
  assert.equal(
    record(base, snapshot("a", 1, { x: 0, y: 0 }, null)).entities.a.snapshots[0].state,
    null
  );
  assert.equal(
    record(base, snapshot("a", 1, { x: 0, y: 0 }, false)).entities.a.snapshots[0].state,
    false
  );
  assert.equal(record(base, snapshot("a", 1, { x: 0, y: 0 }, 0)).entities.a.snapshots[0].state, 0);
});

test("record appends a newer snapshot without mutating the previous buffer", () => {
  const state = { n: 1 };
  const first = record(
    createBuffer({ capacity: 4, maxRewind: 10 }),
    snapshot("a", 1, { x: 1, y: 0 }, state)
  );
  const second = record(first, snapshot("a", 2, { x: 3, y: 4 }, { n: 2 }));
  assert.equal(first.latestTime, 1);
  assert.equal(first.entities.a.snapshots.length, 1);
  assert.equal(first.entities.a.snapshots[0].position.x, 1);
  assert.equal(second.latestTime, 2);
  assert.deepEqual(
    second.entities.a.snapshots.map((item) => item.time),
    [1, 2]
  );
  assert.equal(second.entities.a.snapshots[0].state, state);
  assert.notEqual(second.entities.a.snapshots[0], first.entities.a.snapshots[0]);
  assert.notEqual(second.entities.a.snapshots[0].position, first.entities.a.snapshots[0].position);
  assert.equal(second.capacity, 4);
  assert.equal(second.maxRewind, 10);
  assert.notEqual(second.entities, first.entities);
});

test("the same server time replaces the newest snapshot and does not grow the ring", () => {
  let history = createBuffer({ capacity: 2, maxRewind: 5 });
  history = record(history, snapshot("a", 1, { x: 1, y: 0 }, "one"));
  history = record(history, snapshot("a", 2, { x: 2, y: 0 }, "two"));
  const replaced = record(history, snapshot("a", 2, { x: 9, y: 8 }, "replaced"));
  assert.deepEqual(
    history.entities.a.snapshots.map((item) => item.position.x),
    [1, 2]
  );
  assert.deepEqual(
    replaced.entities.a.snapshots.map((item) => [item.time, item.position.x, item.state]),
    [
      [1, 1, "one"],
      [2, 9, "replaced"]
    ]
  );
  assert.equal(replaced.entities.a.snapshots.length, 2);
  assert.equal(replaced.latestTime, 2);
});

test("a full ring drops the oldest snapshot only when the new time is newer", () => {
  let history = createBuffer({ capacity: 3, maxRewind: 100 });
  history = record(history, snapshot("a", 10, { x: 10, y: 0 }));
  history = record(history, snapshot("a", 20, { x: 20, y: 0 }));
  history = record(history, snapshot("a", 30, { x: 30, y: 0 }));
  const full = history;
  history = record(history, snapshot("a", 40, { x: 40, y: 0 }));
  assert.deepEqual(
    full.entities.a.snapshots.map((item) => item.time),
    [10, 20, 30]
  );
  assert.deepEqual(
    history.entities.a.snapshots.map((item) => item.time),
    [20, 30, 40]
  );
  const replaced = record(history, snapshot("a", 40, { x: 41, y: 0 }));
  assert.deepEqual(
    replaced.entities.a.snapshots.map((item) => [item.time, item.position.x]),
    [
      [20, 20],
      [30, 30],
      [40, 41]
    ]
  );
});

test("a capacity of one keeps only the newest snapshot", () => {
  const first = record(
    createBuffer({ capacity: 1, maxRewind: 0 }),
    snapshot("a", 5, { x: 5, y: 1 })
  );
  const second = record(first, snapshot("a", 6, { x: 6, y: 1 }));
  assert.equal(first.entities.a.snapshots.length, 1);
  assert.equal(first.entities.a.snapshots[0].time, 5);
  assert.deepEqual(second.entities.a.snapshots, [
    { time: 6, position: { x: 6, y: 1, z: 0 }, state: null }
  ]);
});

test("entities keep independent rings and latestTime is the newest time", () => {
  let history = createBuffer({ capacity: 2, maxRewind: 10 });
  history = record(history, snapshot("b", 5, { x: 0, y: 1 }));
  history = record(history, snapshot("a", 3, { x: 1, y: 0 }));
  history = record(history, snapshot("b", 6, { x: 0, y: 2 }));
  const next = record(history, snapshot("a", 4, { x: 2, y: 0 }));
  assert.equal(history.latestTime, 6);
  assert.equal(history.entities.a.snapshots.length, 1);
  assert.equal(next.latestTime, 6);
  assert.deepEqual(
    next.entities.a.snapshots.map((item) => item.time),
    [3, 4]
  );
  assert.deepEqual(
    next.entities.b.snapshots.map((item) => item.time),
    [5, 6]
  );
  assert.equal(next.entities.b, history.entities.b);
});

test("a backwards time throws and leaves the previous buffer in place", () => {
  const history = record(createBuffer(), snapshot("a", 5, { x: 1, y: 1 }));
  const snapshots = history.entities.a.snapshots;
  assert.throws(() => record(history, snapshot("a", 4, { x: 0, y: 0 })), {
    name: "RangeError",
    message: "snapshot time must not move backwards"
  });
  assert.equal(history.entities.a.snapshots, snapshots);
  assert.equal(history.latestTime, 5);
  assert.equal(history.entities.a.snapshots[0].position.x, 1);
});

test("record rejects a snapshot that is not a usable sample", () => {
  const history = createBuffer();
  assert.throws(() => record(null, null), {
    name: "TypeError",
    message: "buffer must be an object"
  });
  assert.throws(() => record(null, snapshot("a", 1, { x: 0, y: 0 })), {
    name: "TypeError",
    message: "buffer must be an object"
  });
  assert.throws(() => record([], snapshot("a", 1, { x: 0, y: 0 })), TypeError);
  assert.throws(() => record(history, null), {
    name: "TypeError",
    message: "snapshot must be an object"
  });
  assert.throws(() => record(history, []), TypeError);
  assert.throws(() => record(history, snapshot("", 1, { x: 0, y: 0 })), {
    name: "TypeError",
    message: "snapshot id must be a non-empty string"
  });
  assert.throws(() => record(history, snapshot(1, 1, { x: 0, y: 0 })), TypeError);
  assert.throws(() => record(history, snapshot("a", Number.NaN, { x: 0, y: 0 })), {
    name: "TypeError",
    message: "snapshot time must be a finite number"
  });
  assert.throws(
    () => record(history, snapshot("a", Number.POSITIVE_INFINITY, { x: 0, y: 0 })),
    TypeError
  );
  assert.throws(() => record(history, snapshot("a", "1", { x: 0, y: 0 })), TypeError);
  assert.throws(() => record(history, snapshot("a", 1, null)), {
    name: "TypeError",
    message: "snapshot position must be an object"
  });
  assert.throws(() => record(history, snapshot("a", 1, [0, 1])), TypeError);
  assert.throws(() => record(history, snapshot("a", 1, { x: 1 })), {
    name: "TypeError",
    message: "position x, y, and z must be finite numbers"
  });
  assert.throws(() => record(history, snapshot("a", 1, { x: "0", y: 1 })), TypeError);
  assert.throws(() => record(history, snapshot("a", 1, { x: 0, y: 1, z: Number.NaN })), TypeError);
  assert.throws(() => record(history, snapshot("a", 1, { x: 0, y: 1, z: null })), TypeError);
  assert.throws(
    () => record(history, snapshot("a", 1, { x: 0, y: 1, z: Number.POSITIVE_INFINITY })),
    TypeError
  );
});

test("a bad position is reported before a backwards time", () => {
  const history = record(createBuffer(), snapshot("a", 5, { x: 1, y: 1 }));
  assert.throws(() => record(history, snapshot("a", 4, { x: 0 })), {
    name: "TypeError",
    message: "position x, y, and z must be finite numbers"
  });
});

test("ordinary object keys that collide with the prototype are entity ids", () => {
  let history = createBuffer();
  history = record(history, snapshot("__proto__", 1, { x: 1, y: 2 }));
  history = record(history, snapshot("constructor", 2, { x: 3, y: 4 }));
  history = record(history, snapshot("toString", 3, { x: 5, y: 6 }));
  assert.equal(history.entities.__proto__.snapshots[0].position.x, 1);
  assert.equal(history.entities.constructor.snapshots[0].position.x, 3);
  assert.equal(history.entities.toString.snapshots[0].position.x, 5);
  assert.equal(Object.getPrototypeOf(history.entities), null);
  assert.equal({}.snapshots, undefined);
  assert.equal(history.latestTime, 3);
});

test("forget drops one entity and recomputes latestTime", () => {
  let history = createBuffer({ capacity: 4, maxRewind: 8 });
  history = record(history, snapshot("a", 3, { x: 1, y: 0 }));
  history = record(history, snapshot("b", 9, { x: 0, y: 1 }));
  history = record(history, snapshot("a", 4, { x: 2, y: 0 }));
  const kept = forget(history, "b");
  assert.equal(history.latestTime, 9);
  assert.equal(history.entities.a.snapshots.length, 2);
  assert.equal(kept.latestTime, 4);
  assert.equal(kept.entities.b, undefined);
  assert.equal(kept.entities.a, history.entities.a);
  assert.equal(kept.capacity, 4);
  assert.equal(kept.maxRewind, 8);
  assert.notEqual(kept, history);
  const empty = forget(kept, "a");
  assert.equal(empty.latestTime, null);
  assert.deepEqual(Object.keys(empty.entities), []);
  assert.equal(Object.getPrototypeOf(empty.entities), null);
});

test("forget of an unknown id returns the same buffer", () => {
  const history = record(createBuffer(), snapshot("a", 1, { x: 0, y: 0 }));
  const empty = createBuffer();
  assert.equal(forget(history, "missing"), history);
  assert.equal(forget(empty, "missing"), empty);
});

test("forget rejects a bad id and a bad buffer", () => {
  const history = createBuffer();
  assert.throws(() => forget(history, ""), {
    name: "TypeError",
    message: "entity id must be a non-empty string"
  });
  assert.throws(() => forget(history, 1), TypeError);
  assert.throws(() => forget(null, "a"), {
    name: "TypeError",
    message: "buffer must be an object"
  });
});

test("record rejects a buffer whose latestTime does not match the snapshots", () => {
  const history = record(createBuffer(), snapshot("a", 4, { x: 0, y: 0 }));
  history.latestTime = 9;
  assert.throws(() => record(history, snapshot("a", 5, { x: 1, y: 0 })), {
    name: "TypeError",
    message: "buffer latestTime does not match the stored snapshots"
  });
});
