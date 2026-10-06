/**
 * Deterministic pseudo-randomness.
 *
 * Every simulation on this site has to produce the same picture on every render,
 * or the labs become impossible to reason about — you would never know whether a
 * number moved because you changed a slider or because the dice landed
 * differently. So: a fixed seed, a linear congruential generator, and a *pure*
 * function that returns the whole sequence up front rather than a closure that
 * mutates as you call it.
 */

/** `count` values in [0, 1), fully determined by the seed. */
export function randomSequence(seed: number, count: number): number[] {
  const out = new Array<number>(count);
  let state = seed >>> 0;
  for (let i = 0; i < count; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = state / 4294967296;
  }
  return out;
}

/** Pick from a list using a value already drawn from `randomSequence`. */
export function pick<T>(items: readonly T[], random: number): T {
  return items[Math.min(items.length - 1, Math.floor(random * items.length))];
}
