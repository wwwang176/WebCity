/**
 * Turns a line of `{"path":"read.city","args":[]}` into an actual call.
 *
 * This is the only part of the bridge with logic; the rest — HTTP middleware, WebSocket — is
 * plumbing, so the tests concentrate here.
 *
 * ## Three requirements
 *
 * **The path must not walk anywhere.** That string comes from outside.
 * `read.constructor.constructor` reaches `Function`, and calling it is arbitrary code execution
 * in the page. So only **own properties** are walked, and the prototype-chain names are
 * explicitly refused.
 *
 * **Nothing throws.** The caller is in another process, where an escaping exception is just a
 * 500 with no message. Every failure becomes `{ ok: false, error }`.
 *
 * **The result must survive JSON.** `commuteStats().byHome` is a `Map`, which
 * `JSON.stringify` turns into `{}`, and the caller reads an empty object as no data.
 */

/** The maximum number of path segments. `read.city` is two, and nothing in this API is
 *  deeper. */
export const MAX_PATH_DEPTH = 2;

/**
 * Property names that are never walked.
 *
 * Without this, `read.constructor.constructor('return process')()` works.
 */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

export interface AgentCall {
  /** For example `read.city`, `act`, `routes.create`. */
  path: string;
  args?: unknown[];
}

export interface AgentResponse {
  ok: boolean;
  result?: unknown;
  error?: string;
}

function fail(error: string): AgentResponse {
  return { ok: false, error };
}

/**
 * Walks the path to the function, along with the object it lives on so `this` can be bound.
 *
 * Calling an extracted function directly leaves `this` undefined, and `AgentRead.city()`'s
 * `this.getState()` throws.
 */
function resolve(root: unknown, path: string): { fn: unknown; owner: unknown } | string {
  const segments = path.split('.');
  if (segments.length > MAX_PATH_DEPTH) {
    return `path is too deep (max ${MAX_PATH_DEPTH} segments): ${path}`;
  }
  if (segments.some(s => s.trim() === '')) {
    return `malformed path: ${JSON.stringify(path)}`;
  }

  let owner: unknown = null;
  let current: unknown = root;
  for (const segment of segments) {
    if (FORBIDDEN.has(segment)) return `refusing to walk into ${segment}`;
    if (current === null || typeof current !== 'object') {
      return `nothing at path ${path}`;
    }
    // Own properties only: everything inherited lives on the prototype chain, which is exactly
    // where this must not go.
    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      // Class methods live on the prototype rather than as own properties of the instance, so a
      // miss falls back to asking whether it is the object's own class method — still without
      // touching Object.prototype.
      const proto = Object.getPrototypeOf(current) as object | null;
      if (!proto || proto === Object.prototype
        || !Object.prototype.hasOwnProperty.call(proto, segment)) {
        return `nothing at path ${path}`;
      }
    }
    owner = current;
    current = (current as Record<string, unknown>)[segment];
  }
  return { fn: current, owner };
}

/**
 * Converts to a shape `JSON.stringify` can send.
 *
 * A `Map` becomes an array of pairs and a `Set` an array. Cycles become `'[circular]'`, since
 * stringify would otherwise throw and turn into a 500 with no message.
 */
export function jsonSafe(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (value instanceof Map) return [...value].map(pair => jsonSafe(pair, seen));
  if (value instanceof Set) return [...value].map(v => jsonSafe(v, seen));
  if (Array.isArray(value)) return value.map(v => jsonSafe(v, seen));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = jsonSafe(v, seen);
  return out;
}

/**
 * Calls that path on `root`.
 *
 * `root` is the page's `window.__agent`. Before a game starts it holds only `session`, and
 * before the main menu it does not exist at all; both return an error rather than throwing.
 */
export async function dispatch(root: unknown, call: AgentCall): Promise<AgentResponse> {
  if (root === null || root === undefined) {
    return fail('no agent yet — the game has not started');
  }
  const path = typeof call?.path === 'string' ? call.path.trim() : '';
  if (path === '') return fail('missing path');

  const found = resolve(root, path);
  if (typeof found === 'string') return fail(found);
  if (typeof found.fn !== 'function') return fail(`${path} is not callable`);

  const args = Array.isArray(call.args) ? call.args : [];
  try {
    const raw: unknown = await (found.fn as (...a: unknown[]) => unknown)
      .apply(found.owner, args);
    return { ok: true, result: jsonSafe(raw) };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}
