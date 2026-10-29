import {
  DEFAULT_CAPACITY,
  DEFAULT_MAX_REWIND,
  assertBuffer,
  assertCapacity,
  assertEntityId,
  assertMaxRewind,
  emptyEntities,
  isObject,
  ownEntity,
  readIncoming
} from "./shape.js";

export { DEFAULT_CAPACITY, DEFAULT_MAX_REWIND };

export function createBuffer(options = {}) {
  if (!isObject(options)) {
    throw new TypeError("options must be an object");
  }
  const capacity = pick(options, "capacity", DEFAULT_CAPACITY);
  const maxRewind = pick(options, "maxRewind", DEFAULT_MAX_REWIND);
  assertCapacity(capacity);
  assertMaxRewind(maxRewind);
  return {
    capacity,
    maxRewind,
    latestTime: null,
    entities: emptyEntities()
  };
}

export function record(buffer, snapshot) {
  assertBuffer(buffer);
  const incoming = readIncoming(snapshot);
  const previous = ownEntity(buffer.entities, incoming.id);
  if (previous != null) {
    const newest = previous.snapshots[previous.snapshots.length - 1].time;
    if (incoming.time < newest) {
      throw new RangeError("snapshot time must not move backwards");
    }
  }
  const entities = copyEntities(buffer.entities);
  entities[incoming.id] = {
    id: incoming.id,
    snapshots: nextSnapshots(
      previous == null ? null : previous.snapshots,
      incoming,
      buffer.capacity
    )
  };
  return {
    capacity: buffer.capacity,
    maxRewind: buffer.maxRewind,
    latestTime:
      buffer.latestTime == null ? incoming.time : Math.max(buffer.latestTime, incoming.time),
    entities
  };
}

export function forget(buffer, id) {
  assertBuffer(buffer);
  assertEntityId(id);
  if (ownEntity(buffer.entities, id) == null) {
    return buffer;
  }
  const entities = emptyEntities();
  let latestTime = null;
  for (const key of Object.keys(buffer.entities)) {
    if (key === id) {
      continue;
    }
    entities[key] = buffer.entities[key];
    const snapshots = entities[key].snapshots;
    const newest = snapshots[snapshots.length - 1].time;
    latestTime = latestTime == null ? newest : Math.max(latestTime, newest);
  }
  return {
    capacity: buffer.capacity,
    maxRewind: buffer.maxRewind,
    latestTime,
    entities
  };
}

function pick(options, key, fallback) {
  if (!Object.hasOwn(options, key) || options[key] === undefined) {
    return fallback;
  }
  return options[key];
}

function copyEntities(entities) {
  const copy = emptyEntities();
  for (const id of Object.keys(entities)) {
    copy[id] = entities[id];
  }
  return copy;
}

function nextSnapshots(previous, incoming, capacity) {
  if (previous == null) {
    return [incomingSnapshot(incoming)];
  }
  const newest = previous[previous.length - 1];
  if (incoming.time === newest.time) {
    const kept = previous.slice(0, -1).map(cloneSnapshot);
    kept.push(incomingSnapshot(incoming));
    return kept;
  }
  const base = previous.length === capacity ? previous.slice(1) : previous.slice();
  const kept = base.map(cloneSnapshot);
  kept.push(incomingSnapshot(incoming));
  return kept;
}

function incomingSnapshot(incoming) {
  return {
    time: incoming.time,
    position: {
      x: incoming.position.x,
      y: incoming.position.y,
      z: incoming.position.z
    },
    state: incoming.state
  };
}

function cloneSnapshot(snapshot) {
  return {
    time: snapshot.time,
    position: {
      x: snapshot.position.x,
      y: snapshot.position.y,
      z: snapshot.position.z
    },
    state: snapshot.state
  };
}
