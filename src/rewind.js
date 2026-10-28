import { assertBuffer, isFiniteNumber } from "./shape.js";

export function rewind(buffer, time) {
  assertBuffer(buffer);
  if (!isFiniteNumber(time)) {
    throw new TypeError("time must be a finite number");
  }
  const latestTime = buffer.latestTime;
  const ids = Object.keys(buffer.entities).sort();
  const entities = [];
  for (const id of ids) {
    entities.push(rewindEntity(buffer.entities[id], time));
  }
  return {
    time,
    latestTime,
    limited: latestTime != null && time < latestTime - buffer.maxRewind,
    ahead: latestTime != null && time > latestTime,
    entities
  };
}

export function checkHit(buffer, time, hit) {
  const world = rewind(buffer, time);
  if (typeof hit !== "function") {
    throw new TypeError("hit must be a function");
  }
  if (world.latestTime == null) {
    return {
      accepted: false,
      limited: false,
      ahead: false,
      time: null,
      latestTime: null,
      result: null
    };
  }
  if (world.limited) {
    return {
      accepted: false,
      limited: true,
      ahead: false,
      time: world.time,
      latestTime: world.latestTime,
      result: null
    };
  }
  return {
    accepted: true,
    limited: false,
    ahead: world.ahead,
    time: world.time,
    latestTime: world.latestTime,
    result: hit(world)
  };
}

function rewindEntity(entity, time) {
  const located = locate(entity.snapshots, time);
  return {
    id: entity.id,
    position: located.position,
    state: located.state,
    alpha: located.alpha,
    clamped: located.clamped,
    fromTime: located.fromTime,
    toTime: located.toTime
  };
}

function locate(snapshots, time) {
  const last = snapshots.length - 1;
  if (time < snapshots[0].time) {
    return endpoint(snapshots[0], true);
  }
  if (time > snapshots[last].time) {
    return endpoint(snapshots[last], true);
  }
  if (snapshots.length === 1) {
    return endpoint(snapshots[0], false);
  }

  let lo = 0;
  let hi = last;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (snapshots[mid].time <= time) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  if (snapshots[lo].time === time) {
    return endpoint(snapshots[lo], false);
  }
  if (snapshots[hi].time === time) {
    return endpoint(snapshots[hi], false);
  }
  return blend(snapshots[lo], snapshots[hi], time);
}

function endpoint(snapshot, clamped) {
  return {
    position: copyPosition(snapshot.position),
    state: snapshot.state,
    alpha: 0,
    clamped,
    fromTime: snapshot.time,
    toTime: snapshot.time
  };
}

function blend(earlier, later, time) {
  const span = later.time - earlier.time;
  const alpha = (time - earlier.time) / span;
  return {
    position: {
      x: earlier.position.x + (later.position.x - earlier.position.x) * alpha,
      y: earlier.position.y + (later.position.y - earlier.position.y) * alpha,
      z: earlier.position.z + (later.position.z - earlier.position.z) * alpha
    },
    state: earlier.state,
    alpha,
    clamped: false,
    fromTime: earlier.time,
    toTime: later.time
  };
}

function copyPosition(position) {
  return {
    x: position.x,
    y: position.y,
    z: position.z
  };
}
