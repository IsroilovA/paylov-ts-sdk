/** The scheduling policy of scripted answers, shared by the method scripts and the token endpoint. */

import type { PaylovFakeSchedule } from '../core/fake.js';
import type { Answer } from './answers.js';

interface QueuedAnswer<K> {
  readonly key: K;
  readonly answer: Answer;
  readonly persist: boolean;
  /** Whether a persistent answer has served a request; one-time answers leave the queue instead. */
  served: boolean;
}

/** A queued answer a request matched, and what the match returned. */
interface FoundAnswer<K, M> {
  readonly queued: QueuedAnswer<K>;
  readonly match: M;
}

/**
 * Scripted answers in the order they were added. A request takes the first one-time answer it
 * matches, else the first persistent one; a one-time answer is used up when served.
 */
export class AnswerQueue<K> {
  readonly #queue: QueuedAnswer<K>[] = [];

  add(key: K, answer: Answer, schedule: PaylovFakeSchedule = {}): void {
    this.#queue.push({
      key,
      answer,
      persist: schedule.persist === true,
      served: false,
    });
  }

  /** The answer for a request, where `match` returns `undefined` for keys the request misses. */
  find<M>(match: (key: K) => M | undefined): FoundAnswer<K, M> | undefined {
    let persistent: FoundAnswer<K, M> | undefined;
    for (const queued of this.#queue) {
      const found = match(queued.key);
      if (found === undefined) continue;
      if (!queued.persist) return { queued, match: found };
      persistent ??= { queued, match: found };
    }
    return persistent;
  }

  /** Serves a found answer: a one-time answer leaves the queue, a persistent one counts as served. */
  serve({ queued }: FoundAnswer<K, unknown>): Answer {
    if (queued.persist) queued.served = true;
    else this.#queue.splice(this.#queue.indexOf(queued), 1);
    return queued.answer;
  }

  /** What `assertDone()` reports: one-time answers left and persistent answers never served. */
  problems(describe: (key: K) => string): string[] {
    return this.#queue.flatMap(({ key, persist, served }) => {
      if (!persist) return [`unserved ${describe(key)} answer`];
      return served ? [] : [`unserved persistent ${describe(key)} answer`];
    });
  }
}
