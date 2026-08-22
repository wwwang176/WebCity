import { describe, it, expect } from 'vitest';
import { dispatch, jsonSafe, MAX_PATH_DEPTH } from '../dispatch';

/**
 * 把一行 `{"path":"read.city","args":[]}` 變成真的呼叫。
 *
 * 這是整座橋唯一有邏輯的地方，其餘（HTTP、WebSocket）都是管線。所以這裡守三件事:
 *
 * 1. **路徑不能亂爬。** 收進來的字串來自外面，`read.constructor.constructor` 這種
 *    東西爬得到 `Function`，那就等於讓對方在頁面裡執行任意程式碼。
 * 2. **不丟例外。** 呼叫端在另一個 process，例外冒出去只會變成一個沒有訊息的 500。
 * 3. **回得出 JSON。** `commuteStats().byHome` 是 `Map`，`JSON.stringify` 會把它變成
 *    `{}` —— 對方看到一個空物件，還以為是沒資料。
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
    // session 那一整塊都是 async。回一個 Promise 出去，序列化之後對方拿到 `{}`。
    const r = await dispatch(fakeAgent(), { path: 'session.list' });
    expect(r.result).toEqual([{ slotId: 1, name: 'Save' }]);
  });

  it('should keep `this` bound to the object the method lives on', async () => {
    // 這一層取出函式再呼叫。不綁 `this` 的話，`AgentRead.city()` 裡的
    // `this.getState()` 會炸開 —— 而假的 agent 用箭頭函式看不出來。
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
    // `read.constructor.constructor` 爬得到 `Function`，呼叫它就等於在頁面裡執行
    // 任意程式碼。這一條擋的是那個。
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
    // 真的 `__agent.read` 是 `AgentRead` 的**實例**,不是物件字面值 —— 而類別的
    // prototype 上帶著一個**自有的** `constructor`。所以「只走自有屬性」那一道
    // 對它是放行的,擋住它的只有禁用名單。
    //
    // 這一條是補回來的:第一版的假 agent 用物件字面值，它的 proto 是
    // `Object.prototype`，被別道守衛擋掉了 —— 名單拿掉測試照樣綠。
    class Read {
      city() { return { population: 1 }; }
    }
    const root = { read: new Read() };

    expect((await dispatch(root, { path: 'read.city' })).ok, '正常的呼叫被擋了').toBe(true);

    // **要在走過去之前就拒絕**，不是走過去拿到類別、呼叫它、然後靠
    // 「class 不能不用 new 呼叫」丟例外。那個巧合擋得住今天這個形狀,擋不住
    // 明天換成別的:一個純函式的 `.constructor` 就是 `Function`。
    // 所以這裡釘的是訊息 —— 有沒有走到那一步，只有訊息看得出來。
    const r = await dispatch(root, { path: 'read.constructor' });
    expect(r.ok, '拿到 AgentRead 這個類別本身了').toBe(false);
    expect(r.error, '是走過去之後才失敗的，不是一開始就拒絕').toContain('refusing to walk into');
  });

  it('should refuse to reach Function through a two-segment path', async () => {
    // 這是這一份名單真正在擋的東西，而且**深度限制擋不住** —— `act` 是頂層函式，
    // `act.constructor` 只有兩段。拿到 `Function` 就等於在頁面裡執行任意程式碼:
    //
    //     act.constructor('return globalThis')()
    //
    // 而它偏偏是自有屬性檢查放行的:`constructor` 在 `Function.prototype` 上，
    // 不在 `Object.prototype` 上。
    const r = await dispatch(fakeAgent(), { path: 'act.constructor' });

    expect(r.ok, '爬到 Function 了').toBe(false);
    expect((await dispatch(fakeAgent(), { path: 'session.list.constructor' })).ok).toBe(false);
  });

  it('should refuse the things every object inherits', async () => {
    // `toString` / `valueOf` 不在禁用名單上 —— 擋住它們的是「只走自有屬性」。
    // 少了那一道，agent 的介面上會憑空多出一堆 Object.prototype 的方法。
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
    // 呼叫端在另一個 process，看不到堆疊 —— 錯誤訊息就是它唯一的線索。
    // 「路徑寫壞了」跟「那裡沒有東西」是兩個要往不同方向修的問題。
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
    // 刪除存檔是刻意沒有的。這條測試是規格:哪天有人加了，這裡要先絆倒。
    const r = await dispatch(fakeAgent(), { path: 'session.delete' });
    expect(r.ok).toBe(false);
  });
});

describe('不把例外丟出去', () => {
  it('should turn a throwing method into a failed result', async () => {
    // 呼叫端在另一個 process。例外冒出去只會變成一個沒有訊息的 500。
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
    // 主選單上 `window.__agent` 只有 session 一塊，開局前根本還沒有 agent。
    const r = await dispatch(null, { path: 'read.city' });

    expect(r.ok).toBe(false);
    expect(r.error).toContain('no agent');
  });
});

describe('回得出 JSON', () => {
  it('should turn a Map into something that survives stringify', () => {
    // `commuteStats().byHome` 是 Map。JSON.stringify 會把它變成 `{}` ——
    // 對方看到空物件，還以為是沒資料。
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
    // 循環參照會讓 JSON.stringify 直接丟例外 —— 那會變成一個沒有訊息的 500。
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
