/**
 * Concurrency and thread pools (chapter 29).
 *
 * Search over N segments is embarrassingly parallel, so the naive move is to
 * throw a thread at each one. The chapter's warning is that unbounded
 * concurrency buys you context switching, memory pressure, contention and
 * queueing — and queueing is what actually shows up as p99.
 *
 * This is a deterministic discrete-event simulation. No real threads, no
 * randomness unless you ask for it, and every number below is produced by the
 * model rather than asserted.
 */

export interface Task {
  id: string;
  requestId: string;
  /** Service time in milliseconds if it had a core to itself. */
  cost: number;
  arrival: number;
}

export interface ScheduledTask extends Task {
  queuedAt: number;
  startedAt: number;
  finishedAt: number;
  worker: number;
  queueWait: number;
}

export interface RejectedTask extends Task {
  reason: "queue-full" | "timed-out";
  rejectedAt: number;
}

export interface PoolConfig {
  workers: number;
  queueCapacity: number;
  /** Requests are abandoned after this long. */
  timeoutMs: number;
  /**
   * Extra cost per busy worker beyond the core count, standing in for context
   * switching and cache contention. Set to 0 for an idealised pool.
   */
  contentionPenalty: number;
  coreCount: number;
}

export const DEFAULT_POOL: PoolConfig = {
  workers: 4,
  queueCapacity: 16,
  timeoutMs: 250,
  contentionPenalty: 0.15,
  coreCount: 4,
};

export interface RequestSpec {
  id: string;
  arrival: number;
  /** One task per segment or shard. */
  taskCosts: number[];
}

export interface RequestOutcome {
  id: string;
  arrival: number;
  /** When the last of its tasks finished. A request is as slow as its slowest part. */
  completedAt: number | null;
  latency: number | null;
  status: "ok" | "partial" | "rejected" | "timed-out";
  tasksCompleted: number;
  tasksRejected: number;
  maxQueueWait: number;
}

export interface SimulationResult {
  scheduled: ScheduledTask[];
  rejected: RejectedTask[];
  requests: RequestOutcome[];
  config: PoolConfig;
  /** Utilisation per worker, 0..1. */
  workerBusy: number[];
  makespan: number;
  maxQueueDepth: number;
  queueDepthOverTime: { time: number; depth: number }[];
}

/**
 * Run the pool. Tasks are taken in arrival order; each goes to the worker that
 * frees up first. Effective cost grows with how many workers are busy, which is
 * how the model expresses contention.
 */
export function simulatePool(requests: RequestSpec[], config: PoolConfig): SimulationResult {
  const tasks: Task[] = [];
  for (const request of requests) {
    request.taskCosts.forEach((cost, i) => {
      tasks.push({
        id: `${request.id}#${i}`,
        requestId: request.id,
        cost,
        arrival: request.arrival,
      });
    });
  }
  tasks.sort((a, b) => a.arrival - b.arrival || a.id.localeCompare(b.id));

  const workerFreeAt = new Array<number>(config.workers).fill(0);
  const workerBusyTime = new Array<number>(config.workers).fill(0);
  const scheduled: ScheduledTask[] = [];
  const rejected: RejectedTask[] = [];
  const queueDepthOverTime: { time: number; depth: number }[] = [];
  let maxQueueDepth = 0;

  for (const task of tasks) {
    // How many tasks are still running or waiting when this one arrives?
    const inFlight = scheduled.filter(
      (s) => s.finishedAt > task.arrival && s.startedAt <= task.arrival,
    ).length;
    const waiting = scheduled.filter(
      (s) => s.queuedAt <= task.arrival && s.startedAt > task.arrival,
    ).length;

    queueDepthOverTime.push({ time: task.arrival, depth: waiting });
    maxQueueDepth = Math.max(maxQueueDepth, waiting);

    if (waiting >= config.queueCapacity) {
      // Backpressure: refuse rather than accept work you cannot do.
      rejected.push({ ...task, reason: "queue-full", rejectedAt: task.arrival });
      continue;
    }

    // Pick the worker that becomes free soonest.
    let bestWorker = 0;
    for (let w = 1; w < config.workers; w++) {
      if (workerFreeAt[w] < workerFreeAt[bestWorker]) bestWorker = w;
    }
    const startedAt = Math.max(task.arrival, workerFreeAt[bestWorker]);
    const queueWait = startedAt - task.arrival;

    if (queueWait > config.timeoutMs) {
      rejected.push({ ...task, reason: "timed-out", rejectedAt: task.arrival + config.timeoutMs });
      continue;
    }

    // Contention: past the core count, everything gets slower.
    const oversubscription = Math.max(0, inFlight + 1 - config.coreCount);
    const effectiveCost = task.cost * (1 + config.contentionPenalty * oversubscription);
    const finishedAt = startedAt + effectiveCost;

    workerFreeAt[bestWorker] = finishedAt;
    workerBusyTime[bestWorker] += effectiveCost;
    scheduled.push({
      ...task,
      queuedAt: task.arrival,
      startedAt,
      finishedAt,
      worker: bestWorker,
      queueWait,
    });
  }

  const makespan = Math.max(0, ...scheduled.map((s) => s.finishedAt));

  const requestOutcomes: RequestOutcome[] = requests.map((request) => {
    const own = scheduled.filter((s) => s.requestId === request.id);
    const ownRejected = rejected.filter((r) => r.requestId === request.id);
    const expected = request.taskCosts.length;

    if (own.length === 0) {
      return {
        id: request.id,
        arrival: request.arrival,
        completedAt: null,
        latency: null,
        status: "rejected",
        tasksCompleted: 0,
        tasksRejected: ownRejected.length,
        maxQueueWait: 0,
      };
    }

    const completedAt = Math.max(...own.map((s) => s.finishedAt));
    const latency = completedAt - request.arrival;
    const timedOut = latency > config.timeoutMs;
    return {
      id: request.id,
      arrival: request.arrival,
      completedAt,
      latency,
      status: timedOut ? "timed-out" : own.length < expected ? "partial" : "ok",
      tasksCompleted: own.length,
      tasksRejected: ownRejected.length,
      maxQueueWait: Math.max(...own.map((s) => s.queueWait)),
    };
  });

  return {
    scheduled,
    rejected,
    requests: requestOutcomes,
    config,
    workerBusy: workerBusyTime.map((busy) => (makespan === 0 ? 0 : busy / makespan)),
    makespan,
    maxQueueDepth,
    queueDepthOverTime,
  };
}

/** Deterministic request stream: `count` requests at a fixed rate. */
export function makeRequestStream(
  count: number,
  ratePerSecond: number,
  segmentCosts: number[],
  jitterSeed = 7,
): RequestSpec[] {
  const gap = 1000 / Math.max(0.001, ratePerSecond);
  let state = jitterSeed >>> 0;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return Array.from({ length: count }, (_, i) => ({
    id: `req-${i + 1}`,
    // A little jitter, deterministically: real traffic is not a metronome.
    arrival: Math.max(0, i * gap + (random() - 0.5) * gap * 0.6),
    taskCosts: segmentCosts.map((c) => c * (0.8 + random() * 0.4)),
  })).sort((a, b) => a.arrival - b.arrival);
}

export const CONCURRENCY_TRADEOFFS = [
  {
    knob: "more workers",
    helps: "keeps cores busy when tasks block on I/O",
    hurts: "context switching, cache thrash, memory per in-flight request",
  },
  {
    knob: "bigger queue",
    helps: "absorbs short bursts instead of rejecting them",
    hurts: "turns a throughput problem into a latency problem — requests wait, then time out anyway",
  },
  {
    knob: "shorter timeout",
    helps: "frees capacity from work nobody is waiting for any more",
    hurts: "converts slow successes into failures, including retries that add load",
  },
  {
    knob: "backpressure (reject early)",
    helps: "keeps latency bounded for the requests you do accept",
    hurts: "visible errors — which is the honest form of overload",
  },
];
