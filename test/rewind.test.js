import assert from "node:assert/strict";
import test from "node:test";
import { createBuffer, record, rewind } from "../src/index.js";

function snap(id, time, x, y = 0, z = 0, state) {
  const value = { id, time, position: { x, y, z } };
  if (arguments.length > 5) {
    value.state = state;
  }
  return value;
}

function historyOf(capacity, maxRewind, samples) {
  let history = createBuffer({ capacity, maxRewind });
  for (const sample of samples) {
    history = record(history, sample);
  }
  return history;
}

function linearPosition(samples, time) {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (time <= first.time) {
    return { x: first.x, y: first.y, z: first.z };
  }
  if (time >= last.time) {
    return { x: last.x, y: last.y, z: last.z };
  }
  let earlier = first;
  for (const sample of samples) {
    if (sample.time === time) {
      return { x: sample.x, y: sample.y, z: sample.z };
    }
    if (sample.time > time) {
      const alpha = (time - earlier.time) / (sample.time - earlier.time);
      return {
        x: earlier.x + (sample.x - earlier.x) * alpha,
        y: earlier.y + (sample.y - earlier.y) * alpha,
        z: earlier.z + (sample.z - earlier.z) * alpha
      };
    }
    earlier = sample;
  }
  return { x: last.x, y: last.y, z: last.z };
}

test("an empty buffer echoes the time and returns no entities", () => {
  assert.deepEqual(rewind(createBuffer(), 40), {
    time: 40,
    latestTime: null,
    limited: false,
    ahead: false,
    entities: []
  });
});

test("one snapshot is exact at its time and clamped everywhere else", () => {
  const history = historyOf(4, 100, [snap("a", 10, 3, 4, 5, "pose")]);
  assert.deepEqual(rewind(history, 10).entities[0], {
    id: "a",
    position: { x: 3, y: 4, z: 5 },
    state: "pose",
    alpha: 0,
    clamped: false,
    fromTime: 10,
    toTime: 10
  });
  assert.deepEqual(rewind(history, 9).entities[0], {
    id: "a",
    position: { x: 3, y: 4, z: 5 },
    state: "pose",
    alpha: 0,
    clamped: true,
    fromTime: 10,
    toTime: 10
  });
  assert.equal(rewind(history, 11).entities[0].clamped, true);
  assert.equal(rewind(history, 11).ahead, true);
  assert.equal(rewind(history, 11).limited, false);
});

test("a time inside an interval blends position and keeps the earlier state", () => {
  const history = historyOf(4, 100, [
    snap("a", 0, 0, 0, 0, "early"),
    snap("a", 4, 8, -4, 4, "late")
  ]);
  const world = rewind(history, 1);
  assert.equal(world.limited, false);
  assert.equal(world.ahead, false);
  assert.equal(world.latestTime, 4);
  assert.deepEqual(world.entities[0], {
    id: "a",
    position: { x: 2, y: -1, z: 1 },
    state: "early",
    alpha: 0.25,
    clamped: false,
    fromTime: 0,
    toTime: 4
  });
  assert.deepEqual(rewind(history, 4).entities[0], {
    id: "a",
    position: { x: 8, y: -4, z: 4 },
    state: "late",
    alpha: 0,
    clamped: false,
    fromTime: 4,
    toTime: 4
  });
  assert.equal(rewind(history, 0).entities[0].state, "early");
  assert.equal(rewind(history, 0).entities[0].clamped, false);
  assert.equal(rewind(history, -1).entities[0].clamped, true);
  assert.equal(rewind(history, -1).entities[0].position.x, 0);
  assert.equal(rewind(history, 5).entities[0].clamped, true);
  assert.equal(rewind(history, 5).entities[0].state, "late");
  assert.equal(rewind(history, 5).entities[0].position.x, 8);
});

test("an exact middle sample is not blended with its neighbors", () => {
  const history = historyOf(8, 100, [
    snap("a", 0, 0, 0, 0, "a"),
    snap("a", 10, 10, 0, 0, "b"),
    snap("a", 20, 20, 0, 0, "c")
  ]);
  const exact = rewind(history, 10).entities[0];
  assert.equal(exact.state, "b");
  assert.equal(exact.alpha, 0);
  assert.equal(exact.fromTime, 10);
  assert.equal(exact.toTime, 10);
  assert.equal(exact.position.x, 10);
  const between = rewind(history, 15).entities[0];
  assert.equal(between.state, "b");
  assert.equal(between.alpha, 0.5);
  assert.equal(between.fromTime, 10);
  assert.equal(between.toTime, 20);
  assert.equal(between.position.x, 15);
  assert.equal(between.clamped, false);
});

test("binary search matches a linear walk across the stored samples", () => {
  const samples = [0, 5, 9, 9.5, 12, 40, 41, 100].map((time) => ({
    time,
    x: time,
    y: -time,
    z: time / 2
  }));
  const history = historyOf(
    16,
    1000,
    samples.map((sample) => snap("e", sample.time, sample.x, sample.y, sample.z, sample.time))
  );
  const queries = [-1, 0, 1, 5, 7, 9, 9.25, 9.5, 12, 20, 40, 41, 70, 100, 130];
  for (const time of queries) {
    const entity = rewind(history, time).entities[0];
    assert.deepEqual(entity.position, linearPosition(samples, time));
    if (time > 40 && time < 41) {
      assert.equal(entity.fromTime, 40);
      assert.equal(entity.toTime, 41);
      assert.equal(entity.state, 40);
    }
  }
  const late = rewind(history, 70).entities[0];
  assert.equal(late.fromTime, 41);
  assert.equal(late.toTime, 100);
  assert.notEqual(late.fromTime, 0);
});

test("the blend weight follows the two bracketing server times", () => {
  const history = historyOf(4, 10, [snap("a", 10, 2, 4, 6), snap("a", 14, 10, 0, 1)]);
  const entity = rewind(history, 11).entities[0];
  const alpha = (11 - 10) / (14 - 10);
  assert.equal(entity.alpha, alpha);
  assert.equal(entity.position.x, 2 + (10 - 2) * alpha);
  assert.equal(entity.position.y, 4 + (0 - 4) * alpha);
  assert.equal(entity.position.z, 6 + (1 - 6) * alpha);
  assert.equal(entity.fromTime, 10);
  assert.equal(entity.toTime, 14);
});

test("entities are returned in lexicographic id order", () => {
  const history = historyOf(4, 20, [
    snap("b", 1, 2),
    snap("a10", 1, 3),
    snap("a2", 1, 4),
    snap("a", 1, 1)
  ]);
  const world = rewind(history, 1);
  assert.deepEqual(
    world.entities.map((entity) => entity.id),
    ["a", "a10", "a2", "b"]
  );
  assert.deepEqual(
    world.entities.map((entity) => entity.position.x),
    [1, 3, 4, 2]
  );
});

test("each entity clamps to its own samples", () => {
  const history = historyOf(8, 500, [
    snap("mover", 1000, 0, 0, 0, "from"),
    snap("mover", 1100, 10, 0, 0, "to"),
    snap("still", 1100, 4, 4, 1, "only")
  ]);
  const world = rewind(history, 1050);
  assert.equal(world.latestTime, 1100);
  assert.equal(world.limited, false);
  assert.deepEqual(world.entities[0], {
    id: "mover",
    position: { x: 5, y: 0, z: 0 },
    state: "from",
    alpha: 0.5,
    clamped: false,
    fromTime: 1000,
    toTime: 1100
  });
  assert.deepEqual(world.entities[1], {
    id: "still",
    position: { x: 4, y: 4, z: 1 },
    state: "only",
    alpha: 0,
    clamped: true,
    fromTime: 1100,
    toTime: 1100
  });
});

test("a time past the newest sample is ahead and clamps every entity", () => {
  const history = historyOf(4, 50, [snap("a", 10, 1, 2, 3), snap("b", 12, 4, 5, 6)]);
  const world = rewind(history, 20);
  assert.equal(world.ahead, true);
  assert.equal(world.limited, false);
  assert.equal(world.time, 20);
  assert.equal(world.entities[0].clamped, true);
  assert.equal(world.entities[0].position.x, 1);
  assert.equal(world.entities[1].clamped, true);
  assert.equal(world.entities[1].position.x, 4);
  assert.equal(rewind(history, 12).ahead, false);
});

test("max rewind flags the query and does not move stored positions", () => {
  const history = historyOf(8, 50, [
    snap("a", 1000, 0, 0, 0, "old"),
    snap("a", 1100, 10, 0, 0, "new")
  ]);
  const inspected = rewind(history, 1000);
  assert.equal(inspected.limited, true);
  assert.equal(inspected.ahead, false);
  assert.equal(inspected.time, 1000);
  assert.equal(inspected.latestTime, 1100);
  assert.equal(inspected.entities[0].clamped, false);
  assert.equal(inspected.entities[0].position.x, 0);
  assert.equal(inspected.entities[0].state, "old");

  const boundary = rewind(history, 1050);
  assert.equal(boundary.limited, false);
  assert.equal(boundary.entities[0].position.x, 5);
  assert.equal(boundary.entities[0].alpha, 0.5);

  const inside = rewind(history, 1040);
  assert.equal(inside.limited, true);
  assert.equal(inside.entities[0].alpha, 0.4);
  assert.equal(inside.entities[0].position.x, 4);
  assert.equal(inside.entities[0].clamped, false);
});

test("a zero max rewind limits every time before the newest sample", () => {
  const history = historyOf(4, 0, [snap("a", 10, 1), snap("a", 20, 2)]);
  assert.equal(rewind(history, 20).limited, false);
  assert.equal(rewind(history, 19).limited, true);
  assert.equal(rewind(history, 19).entities[0].clamped, false);
  assert.equal(rewind(history, 10).entities[0].position.x, 1);
});

test("negative coordinates and negative server times interpolate", () => {
  const history = historyOf(4, 100, [snap("a", -20, -10, 4, -2), snap("a", -10, 10, -4, 2)]);
  const entity = rewind(history, -15).entities[0];
  assert.equal(entity.position.x, 0);
  assert.equal(entity.position.y, 0);
  assert.equal(entity.position.z, 0);
  assert.equal(entity.alpha, 0.5);
  assert.equal(rewind(history, -15).limited, false);
  assert.equal(rewind(history, -20).latestTime, -10);
});

test("dropping the oldest sample moves the stored window forward", () => {
  let history = createBuffer({ capacity: 3, maxRewind: 1000 });
  history = record(history, snap("a", 10, 10));
  history = record(history, snap("a", 20, 20));
  history = record(history, snap("a", 30, 30));
  const before = history;
  history = record(history, snap("a", 40, 40));
  assert.equal(rewind(before, 10).entities[0].clamped, false);
  assert.equal(rewind(before, 10).entities[0].position.x, 10);
  assert.equal(rewind(history, 10).entities[0].clamped, true);
  assert.equal(rewind(history, 10).entities[0].position.x, 20);
  assert.equal(rewind(history, 25).entities[0].position.x, 25);
  assert.equal(rewind(history, 25).entities[0].fromTime, 20);
  assert.equal(rewind(history, 25).entities[0].toTime, 30);
});

test("rewind copies positions and does not mutate the buffer", () => {
  const history = historyOf(4, 10, [snap("a", 1, 2, 3, 4, { n: 1 })]);
  const first = rewind(history, 1);
  const second = rewind(history, 1);
  first.entities[0].position.x = 99;
  first.entities.push({ id: "extra" });
  assert.equal(history.entities.a.snapshots[0].position.x, 2);
  assert.equal(second.entities[0].position.x, 2);
  assert.notEqual(first.entities[0].position, second.entities[0].position);
  assert.equal(first.entities[0].state, history.entities.a.snapshots[0].state);
  assert.deepEqual(rewind(history, 1).entities[0].position, { x: 2, y: 3, z: 4 });
});

test("two rewinds of the same buffer are deep equal", () => {
  const history = historyOf(4, 30, [snap("b", 1, 1), snap("a", 2, 2), snap("a", 4, 6)]);
  assert.deepEqual(rewind(history, 3), rewind(history, 3));
});

test("rewind rejects a bad time and a malformed buffer", () => {
  const history = historyOf(4, 10, [snap("a", 1, 1)]);
  assert.throws(() => rewind(history, Number.NaN), {
    name: "TypeError",
    message: "time must be a finite number"
  });
  assert.throws(() => rewind(history, Number.POSITIVE_INFINITY), TypeError);
  assert.throws(() => rewind(history, "1"), TypeError);
  assert.throws(() => rewind(null, 1), {
    name: "TypeError",
    message: "buffer must be an object"
  });

  const mismatched = historyOf(4, 10, [snap("a", 1, 1)]);
  mismatched.latestTime = 2;
  assert.throws(() => rewind(mismatched, 1), {
    name: "TypeError",
    message: "buffer latestTime does not match the stored snapshots"
  });

  const crowded = createBuffer({ capacity: 1, maxRewind: 1 });
  crowded.latestTime = 2;
  crowded.entities.a = {
    id: "a",
    snapshots: [
      { time: 1, position: { x: 0, y: 0, z: 0 }, state: null },
      { time: 2, position: { x: 1, y: 0, z: 0 }, state: null }
    ]
  };
  assert.throws(() => rewind(crowded, 2), {
    name: "RangeError",
    message: "entity history exceeds capacity"
  });

  const unsorted = createBuffer({ capacity: 4, maxRewind: 1 });
  unsorted.latestTime = 1;
  unsorted.entities.a = {
    id: "a",
    snapshots: [
      { time: 1, position: { x: 0, y: 0, z: 0 }, state: null },
      { time: 1, position: { x: 1, y: 0, z: 0 }, state: null }
    ]
  };
  assert.throws(() => rewind(unsorted, 1), {
    name: "RangeError",
    message: "snapshot times must increase"
  });

  const renamed = historyOf(4, 10, [snap("a", 1, 1)]);
  renamed.entities.a.id = "b";
  assert.throws(() => rewind(renamed, 1), {
    name: "TypeError",
    message: "entity id must match its key"
  });
});
