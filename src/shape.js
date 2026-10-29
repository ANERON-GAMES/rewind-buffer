export const DEFAULT_CAPACITY = 64;
export const DEFAULT_MAX_REWIND = 1000;

export function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function emptyEntities() {
  return Object.create(null);
}

export function assertCapacity(capacity) {
  if (typeof capacity !== "number" || !Number.isInteger(capacity) || capacity < 1) {
    throw new TypeError("capacity must be a positive integer");
  }
}

export function assertMaxRewind(maxRewind) {
  if (!isFiniteNumber(maxRewind) || maxRewind < 0) {
    throw new TypeError("maxRewind must be a non-negative finite number");
  }
}

export function assertBuffer(buffer) {
  if (!isObject(buffer)) {
    throw new TypeError("buffer must be an object");
  }
  assertCapacity(buffer.capacity);
  assertMaxRewind(buffer.maxRewind);
  if (buffer.latestTime != null && !isFiniteNumber(buffer.latestTime)) {
    throw new TypeError("buffer latestTime must be a finite number or null");
  }
  const latestTime = latestStoredTime(buffer.entities, buffer.capacity);
  if (buffer.latestTime == null) {
    if (latestTime != null) {
      throw new TypeError("buffer latestTime does not match the stored snapshots");
    }
    return;
  }
  if (buffer.latestTime !== latestTime) {
    throw new TypeError("buffer latestTime does not match the stored snapshots");
  }
}

export function readIncoming(snapshot) {
  if (!isObject(snapshot)) {
    throw new TypeError("snapshot must be an object");
  }
  if (typeof snapshot.id !== "string" || snapshot.id.length === 0) {
    throw new TypeError("snapshot id must be a non-empty string");
  }
  if (!isFiniteNumber(snapshot.time)) {
    throw new TypeError("snapshot time must be a finite number");
  }
  return {
    id: snapshot.id,
    time: snapshot.time,
    position: readPosition(snapshot.position, true),
    state: snapshot.state === undefined ? null : snapshot.state
  };
}

export function assertEntityId(id) {
  if (typeof id !== "string" || id.length === 0) {
    throw new TypeError("entity id must be a non-empty string");
  }
}

export function ownEntity(entities, id) {
  if (!Object.hasOwn(entities, id)) {
    return null;
  }
  return entities[id];
}

function latestStoredTime(entities, capacity) {
  if (!isObject(entities)) {
    throw new TypeError("buffer entities must be an object");
  }
  let latestTime = null;
  for (const id of Object.keys(entities)) {
    const entity = entities[id];
    if (!isObject(entity)) {
      throw new TypeError("entity must be an object");
    }
    if (entity.id !== id) {
      throw new TypeError("entity id must match its key");
    }
    const snapshots = readStoredSnapshots(entity.snapshots, capacity);
    const newest = snapshots[snapshots.length - 1].time;
    latestTime = latestTime == null ? newest : Math.max(latestTime, newest);
  }
  return latestTime;
}

function readStoredSnapshots(snapshots, capacity) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    throw new TypeError("entity snapshots must be a non-empty array");
  }
  if (snapshots.length > capacity) {
    throw new RangeError("entity history exceeds capacity");
  }
  let previousTime = null;
  for (const snapshot of snapshots) {
    if (!isObject(snapshot)) {
      throw new TypeError("snapshot must be an object");
    }
    if (!isFiniteNumber(snapshot.time)) {
      throw new TypeError("snapshot time must be a finite number");
    }
    if (previousTime != null && snapshot.time <= previousTime) {
      throw new RangeError("snapshot times must increase");
    }
    readPosition(snapshot.position, false);
    previousTime = snapshot.time;
  }
  return snapshots;
}

function readPosition(position, allowMissingZ) {
  if (!isObject(position)) {
    throw new TypeError("snapshot position must be an object");
  }
  const z = allowMissingZ && position.z === undefined ? 0 : position.z;
  if (!isFiniteNumber(position.x) || !isFiniteNumber(position.y) || !isFiniteNumber(z)) {
    throw new TypeError("position x, y, and z must be finite numbers");
  }
  return { x: position.x, y: position.y, z };
}
