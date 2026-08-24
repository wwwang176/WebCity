import { describe, it, expect } from 'vitest';
import { dispatch, jsonSafe, MAX_PATH_DEPTH } from '../dispatch';

/**
 * Turning a line of `{"path":"read.city","args":[]}` into an actual call.
 *
 * The only part of the bridge with logic; the rest — HTTP, WebSocket — is plumbing. Three
 * things are guarded here:
 *
 * 1. **The path must not walk anywhere.** The incoming string comes from outside, and
 *    `read.constructor.constructor` reaches `Function`, which is arbitrary code execution in
 *    the page.
 * 2. **Nothing throws.** The caller is in another process, where an escaping exception is a 500
 *    with no message.
 * 3. **The result survives JSON.** `commuteStats().byHome` is a `Map`, which `JSON.stringify`
 *    turns into `{}`, and the caller reads an empty object as no data.
 */

function fakeAgent() {
  const calls: string[] = [];
  return {
    calls,
    act: (a: unknown) => { calls.push(`act ${JSON.stringify(a)}`); return { ok: true }; },
    read: {
      city: () => ({ population: 1234 }),
      abandonmentStress: (x: number, y: number) => x * 100 + y,
      commuteStats: () => ({ byHome: new Map([['3,3', 12]]), sampled: 1 }),
      blowUp: () => { throw new Error('kaboom'); },
      notAFunction: 42,
    },
    session: {
      list: async () => [{ slotId: 1, name: 'Save' }],
      failing: async () => { throw new Error('io died'); },
    },
  };
}

describe('照著路徑呼叫', () => {
  it('should call a nested method and hand back what it returned', async () => {
    const r = await dispatch(fakeAgent(), { path: 'read.city' });
    expect(r).toEqual({ ok: true, result: { population: 1234 } });
  });

  it('should call a top-level function', async () => {
    const a = fakeAgent();
    const r = await dispatch(a, { path: 'act', args: [{ tool: 'road', x1: 1, y1: 1 }] });

    expect(r.ok).toBe(true);
    expect(a.calls).toEqual(['act {"tool":"road","x1":1,"y1":1}']);
  });

  it('should pass the arguments through in order', async () => {
    const r = await dispatch(fakeAgent(), { path: 'read.abandonmentStress', args: [4, 7] });
    expect(r.result, '參數順序掉了').toBe(407);
  });

  it('should treat a missing args list as no arguments', async () => {
    expect((await dispatch(fakeAgent(), { path: 'read.city' })).ok).toBe(true);
  });

  it('should wait for a promise instead of returning it', async () => {
    // The whole session block is async. Returning a promise serialises to `{}` for the caller.
    const r = await dispatch(fakeAgent(), { path: 'session.list' });
    expect(r.result).toEqual([{ slotId: 1, name: 'Save' }]);
  });

  it('should keep `this` bound to the object the method lives on', async () => {
    // This layer extracts a function and then calls it. Without binding `this`,
    // `AgentRead.city()`'s `this.getState()` throws — invisible with an arrow-function stub.
    class Real {
      private secret = 7;
      value() { return this.secret; }
    }
    const r = await dispatch({ read: new Real() }, { path: 'read.value' });

    expect(r.ok, 'this 掉了').toBe(true);
    expect(r.result).toBe(7);
  });
});

describe('路徑不能亂爬', () => {
  it('should refuse to walk into the prototype chain', async () => {
    // `read.constructor.constructor` reaches `Function`, and calling it is arbitrary code
    // execution in the page.
    for (const path of [
      'read.constructor',
      'read.__proto__',
      'constructor.constructor',
      'read.city.constructor',
      'read.prototype',
    ]) {
      const r = await dispatch(fakeAgent(), { path });
      expect(r.ok, `${path} 爬過去了`).toBe(false);
    }
  });

  it('should refuse the constructor of a class instance', async () => {
    // The real `__agent.read` is an **instance** of `AgentRead`, not an object literal, and a
    // class prototype carries its **own** `constructor`. So the own-property rule lets it
    // through and only the forbidden list stops it.
    //
    // A stub built from an object literal has `Object.prototype` as its proto and is stopped by
    // a different guard, leaving the test green with the list removed.
    class Read {
      city() { return { population: 1 }; }
    }
    const root = { read: new Read() };

    expect((await dispatch(root, { path: 'read.city' })).ok, '正常的呼叫被擋了').toBe(true);

    // **Refused before walking there**, not by walking there, getting the class, calling it and
    // relying on "a class cannot be called without new" to throw. That coincidence holds for
    // this shape and not the next: a plain function's `.constructor` is `Function`. The message
    // is what is pinned, because it is the only evidence of whether the walk happened.
    const r = await dispatch(root, { path: 'read.constructor' });
    expect(r.ok, '拿到 AgentRead 這個類別本身了').toBe(false);
    expect(r.error, '是走過去之後才失敗的，不是一開始就拒絕').toContain('refusing to walk into');
  });

  it('should refuse to reach Function through a two-segment path', async () => {
    // What the forbidden list actually stops, and **the depth limit cannot**: `act` is a
    // top-level function, so `act.constructor` is only two segments. Reaching `Function` is
    // arbitrary code execution in the page:
    //
    //     act.constructor('return globalThis')()
    //
    // And the own-property check lets it through: `constructor` lives on `Function.prototype`,
    // not `Object.prototype`.
    const r = await dispatch(fakeAgent(), { path: 'act.constructor' });

    expect(r.ok, '爬到 Function 了').toBe(false);
    expect((await dispatch(fakeAgent(), { path: 'session.list.constructor' })).ok).toBe(false);
  });

  it('should refuse the things every object inherits', async () => {
    // `toString` / `valueOf` are not on the forbidden list; the own-property rule stops them.
    // Without it, the agent's surface would sprout every Object.prototype method.
    for (const path of ['read.toString', 'read.valueOf', 'read.hasOwnProperty']) {
      expect((await dispatch(fakeAgent(), { path })).ok, `${path} 被當成 API 了`).toBe(false);
    }
  });

  it('should refuse a path deeper than the API actually goes', async () => {
    const deep = Array(MAX_PATH_DEPTH + 1).fill('read').join('.');
    const r = await dispatch(fakeAgent(), { path: deep });

    expect(r.ok).toBe(false);
    expect(r.error).toContain('too deep');
  });

  it('should refuse an empty or malformed path', async () => {
    for (const path of ['', '   ', '.', 'read.', '.city', 'read..city']) {
      expect((await dispatch(fakeAgent(), { path })).ok, `接受了 "${path}"`).toBe(false);
    }
  });

  it('should name the actual problem instead of saying nothing is there', async () => {
    // The caller is in another process and cannot see the stack, so the error message is its
    // only clue. "The path is malformed" and "nothing lives there" are fixed in different
    // directions.
    expect((await dispatch(fakeAgent(), { path: 'read.' })).error,
      '路徑寫壞了卻說那裡沒東西').toContain('malformed');
    expect((await dispatch(fakeAgent(), { path: '' })).error,
      '根本沒給路徑卻說那裡沒東西').toContain('missing path');
    expect((await dispatch(fakeAgent(), { path: undefined as unknown as string })).error)
      .toContain('missing path');
  });

  it('should say so when nothing lives at that path', async () => {
    const r = await dispatch(fakeAgent(), { path: 'read.nope' });

    expect(r.ok).toBe(false);
    expect(r.error, '沒說是哪個路徑找不到').toContain('read.nope');
  });

  it('should say so when the path is not something you can call', async () => {
    const r = await dispatch(fakeAgent(), { path: 'read.notAFunction' });

    expect(r.ok).toBe(false);
    expect(r.error).toContain('not callable');
  });

  it('should refuse to reach a method that does not exist on purpose', async () => {
    // Deleting saves is deliberately absent. This test is the specification: anyone adding it
    // trips here first.
    const r = await dispatch(fakeAgent(), { path: 'session.delete' });
    expect(r.ok).toBe(false);
  });
});

describe('不把例外丟出去', () => {
  it('should turn a throwing method into a failed result', async () => {
    // The caller is in another process, where an escaping exception is a 500 with no message.
    const r = await dispatch(fakeAgent(), { path: 'read.blowUp' });

    expect(r.ok).toBe(false);
    expect(r.error, '錯誤訊息被吃掉了').toContain('kaboom');
  });

  it('should turn a rejected promise into a failed result', async () => {
    const r = await dispatch(fakeAgent(), { path: 'session.failing' });

    expect(r.ok).toBe(false);
    expect(r.error).toContain('io died');
  });

  it('should say so when there is no game running yet', async () => {
    // On the main menu `window.__agent` holds only session, and before that there is no agent
    // at all.
    const r = await dispatch(null, { path: 'read.city' });

    expect(r.ok).toBe(false);
    expect(r.error).toContain('no agent');
  });
});

describe('回得出 JSON', () => {
  it('should turn a Map into something that survives stringify', () => {
    // `commuteStats().byHome` is a Map, which JSON.stringify turns into `{}`, and the caller
    // reads an empty object as no data.
    const out = jsonSafe(new Map([['3,3', 12], ['4,4', 30]]));
    expect(out).toEqual([['3,3', 12], ['4,4', 30]]);
  });

  it('should turn a Set into an array', () => {
    expect(jsonSafe(new Set(['1,1', '2,2']))).toEqual(['1,1', '2,2']);
  });

  it('should reach Maps nested inside a result', () => {
    const out = jsonSafe({ byHome: new Map([['3,3', 12]]), sampled: 1 }) as Record<string, unknown>;
    expect(out.byHome).toEqual([['3,3', 12]]);
    expect(out.sampled).toBe(1);
  });

  it('should convert the Maps a real call returns', async () => {
    const r = await dispatch(fakeAgent(), { path: 'read.commuteStats' });
    expect((r.result as Record<string, unknown>).byHome).toEqual([['3,3', 12]]);
  });

  it('should not choke on a result that points back at itself', () => {
    // A cycle makes JSON.stringify throw, which becomes a 500 with no message.
    const loop: Record<string, unknown> = { name: 'a' };
    loop.self = loop;

    expect(() => JSON.stringify(jsonSafe(loop))).not.toThrow();
  });

  it('should keep the plain values alone', () => {
    expect(jsonSafe(42)).toBe(42);
    expect(jsonSafe('hi')).toBe('hi');
    expect(jsonSafe(null)).toBeNull();
    expect(jsonSafe(undefined)).toBeUndefined();
    expect(jsonSafe([1, 2, 3])).toEqual([1, 2, 3]);
  });
});
