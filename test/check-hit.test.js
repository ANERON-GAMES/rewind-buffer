import assert from "node:assert/strict";
import test from "node:test";
import { checkHit, createBuffer, record, rewind } from "../src/index.js";

function snap(id, time, x, y = 0, state) {
  const value = { id, time, position: { x, y } };
  if (arguments.length > 4) {
    value.state = state;
  }
  return value;
}

function usageHistory() {
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
  return history;
}

test("the usage sample rewinds one entity and clamps the other", () => {
  const history = usageHistory();
  const world = rewind(history, 1050);
  assert.equal(world.latestTime, 1100);
  assert.equal(world.limited, false);
  assert.equal(world.ahead, false);
  assert.equal(world.entities[0].id, "a");
  assert.deepEqual(world.entities[0].position, { x: 5, y: 0, z: 0 });
  assert.equal(world.entities[0].alpha, 0.5);
  assert.equal(world.entities[0].clamped, false);
  assert.deepEqual(world.entities[0].state, { pose: "run" });
  assert.equal(world.entities[1].id, "b");
  assert.deepEqual(world.entities[1].position, { x: 4, y: 4, z: 0 });
  assert.equal(world.entities[1].clamped, true);
  assert.equal(world.entities[1].state, null);

  const hit = checkHit(history, 1050, (rewound) => {
    const target = rewound.entities.find((entity) => entity.id === "a");
    return target.position.x === 5;
  });
  assert.equal(hit.accepted, true);
  assert.equal(hit.limited, false);
  assert.equal(hit.ahead, false);
  assert.equal(hit.time, 1050);
  assert.equal(hit.latestTime, 1100);
  assert.equal(hit.result, true);

  let calls = 0;
  const rejected = checkHit(history, 1000, () => {
    calls += 1;
    return true;
  });
  assert.equal(calls, 0);
  assert.deepEqual(rejected, {
    accepted: false,
    limited: true,
    ahead: false,
    time: 1000,
    latestTime: 1100,
    result: null
  });

  const inspected = rewind(history, 1000);
  assert.equal(inspected.limited, true);
  assert.equal(inspected.entities[0].position.x, 0);
  assert.equal(inspected.entities[0].clamped, false);
});

test("checkHit passes the rewind world through and returns the callback value", () => {
  const history = usageHistory();
  const world = rewind(history, 1050);
  const outcome = checkHit(history, 1050, (candidate) => {
    assert.deepEqual(candidate, world);
    return undefined;
  });
  assert.equal(outcome.accepted, true);
  assert.equal(outcome.result, undefined);
  assert.equal(checkHit(history, 1050, () => null).result, null);
});

test("a hit past the limit does not run, including a zero max rewind", () => {
  let history = createBuffer({ capacity: 4, maxRewind: 0 });
  history = record(history, snap("a", 10, 1));
  history = record(history, snap("a", 20, 2));
  let calls = 0;
  const rejected = checkHit(history, 19, () => {
    calls += 1;
    return true;
  });
  assert.equal(calls, 0);
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.limited, true);
  assert.equal(rejected.time, 19);
  const accepted = checkHit(history, 20, (world) => world.entities[0].position.x);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.result, 2);
  assert.equal(accepted.ahead, false);
});

test("an empty buffer does not call the hit callback", () => {
  let calls = 0;
  const outcome = checkHit(createBuffer(), 10, () => {
    calls += 1;
    return true;
  });
  assert.equal(calls, 0);
  assert.deepEqual(outcome, {
    accepted: false,
    limited: false,
    ahead: false,
    time: null,
    latestTime: null,
    result: null
  });
});

test("a time ahead of the newest sample still runs against the clamped positions", () => {
  let history = createBuffer({ capacity: 4, maxRewind: 100 });
  history = record(history, snap("a", 10, 3, 0, "now"));
  const outcome = checkHit(history, 40, (world) => {
    assert.equal(world.ahead, true);
    assert.equal(world.entities[0].clamped, true);
    assert.equal(world.entities[0].position.x, 3);
    return "now";
  });
  assert.equal(outcome.accepted, true);
  assert.equal(outcome.ahead, true);
  assert.equal(outcome.limited, false);
  assert.equal(outcome.time, 40);
  assert.equal(outcome.result, "now");
});

test("the boundary time is accepted and the next older time is not", () => {
  let history = createBuffer({ capacity: 4, maxRewind: 100 });
  history = record(history, snap("a", 0, 0));
  history = record(history, snap("a", 1000, 1000));
  const boundary = checkHit(history, 900, (world) => world.entities[0].position.x);
  assert.equal(boundary.accepted, true);
  assert.equal(boundary.limited, false);
  const alpha = (900 - 0) / (1000 - 0);
  assert.equal(boundary.result, 0 + (1000 - 0) * alpha);
  let calls = 0;
  const older = checkHit(history, 899, () => {
    calls += 1;
    return true;
  });
  assert.equal(calls, 0);
  assert.equal(older.accepted, false);
  assert.equal(older.limited, true);
  assert.equal(rewind(history, 899).entities[0].position.x, 0 + (1000 - 0) * ((899 - 0) / 1000));
});

test("a legal query still includes an entity clamped to a shorter history", () => {
  let history = createBuffer({ capacity: 4, maxRewind: 500 });
  history = record(history, snap("old", 100, 1));
  history = record(history, snap("old", 200, 2));
  history = record(history, snap("late", 180, 9));
  const outcome = checkHit(history, 150, (world) => {
    return world.entities.map((entity) => [entity.id, entity.clamped, entity.position.x]);
  });
  assert.equal(outcome.accepted, true);
  assert.deepEqual(outcome.result, [
    ["late", true, 9],
    ["old", false, 1.5]
  ]);
});

test("the callback can mutate its world without changing the buffer", () => {
  let history = createBuffer({ capacity: 4, maxRewind: 20 });
  history = record(history, snap("a", 1, 4, 5));
  checkHit(history, 1, (world) => {
    world.entities[0].position.x = 0;
    return world;
  });
  assert.equal(history.entities.a.snapshots[0].position.x, 4);
  assert.equal(rewind(history, 1).entities[0].position.x, 4);
});

test("a callback exception propagates and leaves the buffer unchanged", () => {
  const history = record(createBuffer({ capacity: 2, maxRewind: 5 }), snap("a", 1, 1));
  assert.throws(
    () =>
      checkHit(history, 1, () => {
        throw new Error("miss");
      }),
    { name: "Error", message: "miss" }
  );
  assert.equal(history.latestTime, 1);
  assert.equal(history.entities.a.snapshots[0].position.x, 1);
});

test("checkHit validates the buffer and the time before the callback", () => {
  const history = record(createBuffer(), snap("a", 1, 1));
  assert.throws(() => checkHit(history, Number.NaN, "nope"), {
    name: "TypeError",
    message: "time must be a finite number"
  });
  assert.throws(() => checkHit(history, 1, null), {
    name: "TypeError",
    message: "hit must be a function"
  });
  assert.throws(() => checkHit(createBuffer(), 1, "nope"), {
    name: "TypeError",
    message: "hit must be a function"
  });
  assert.throws(() => checkHit(history, 1 - 1000, "nope"), {
    name: "TypeError",
    message: "hit must be a function"
  });
});
