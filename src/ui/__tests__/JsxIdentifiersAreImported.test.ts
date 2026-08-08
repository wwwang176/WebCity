import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `BuildingPanel.tsx` used `<For each={...}>` three times and imported only
 * `Show` and `Index`. In Solid, JSX inside a component body is compiled to a
 * call on the identifier, so `<For>` became a bare reference to an undefined
 * name — a ReferenceError thrown the moment the panel rendered. Selecting any
 * building blanked the info panel.
 *
 * It survived because nothing renders these components in a test, and `tsc`
 * does report it (TS2304) but `pnpm build` had 321 errors so one more was
 * invisible.
 *
 * This is deliberately a lint, not a render test: it needs no DOM, it covers
 * every .tsx at once, and the failure it prevents is exactly "a capitalised
 * JSX tag that resolves to nothing".
 */
const UI_ROOT = join(process.cwd(), 'src', 'ui');

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') tsxFiles(full, out);
    } else if (entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Comments and string/template literals, blanked out.
 *
 * Without this the check reads its own prose: a comment saying `const For` was
 * enough to convince the first version that `For` was bound, which silences the
 * check for exactly the name being discussed.
 */
function stripCommentsAndStrings(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

/**
 * The ROOT identifier of every capitalised JSX tag: `For`, `Show`, and `Tabs`
 * from `<Tabs.Panel>`. Lowercase tags are host elements.
 *
 * The member form matters more than it looks. `<Dialog.Title>` is idiomatic
 * Solid, and an unimported `Dialog` throws the same ReferenceError as the
 * `<For>` this file was written for — but the first version required
 * `[\s/>]` straight after the name, so `<Tabs.` matched nothing at all and the
 * tag was invisible.
 *
 * The leading-character class separates a tag from a type argument:
 * `createSignal<PageId>('summary')` has an identifier immediately before the
 * `<`, whereas a JSX tag follows whitespace, a bracket or an operator — `&&`
 * and `;` among them, which the first version's class omitted.
 */
const TAG_RE = /(?:^|[\s(\[{=>,?:;&|!])<\/?([A-Z][A-Za-z0-9_]*)(?:\.[A-Za-z0-9_]+)*[\s/>]/gm;

function jsxComponentTags(src: string): Set<string> {
  const found = new Set<string>();
  for (const m of src.matchAll(TAG_RE)) found.add(m[1]!);
  return found;
}

/**
 * Does `name` appear anywhere in the file OTHER than as a JSX tag?
 *
 * This replaces an enumeration of binding forms, which could only ever be
 * incomplete: the first version knew about `import`, `function`, `const` and
 * friends, and so falsely rejected `function D(Comp: Component) { return <Comp/> }`
 * and `const { Panel } = CONSTS`, because a parameter and a destructured
 * binding match none of those patterns.
 *
 * An identifier that is genuinely missing — the case this file exists for —
 * occurs in tag position and nowhere else. Anything that binds it, by any
 * syntax present or future, leaves an occurrence behind.
 */
function usedOutsideJsxTags(src: string, name: string): boolean {
  const withoutTags = src.replace(new RegExp(`</?${name}\\b`, 'g'), ' ');
  return new RegExp(`\\b${name}\\b`).test(withoutTags);
}

describe('every JSX component tag resolves to something', () => {
  const files = tsxFiles(UI_ROOT);

  it('should find the .tsx files to check', () => {
    // Without this the suite passes vacuously if the layout ever moves.
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files.map(f => [f.slice(process.cwd().length + 1), f]))(
    '%s',
    (_label, file) => {
      const src = stripCommentsAndStrings(readFileSync(file, 'utf8'));
      const unresolved = [...jsxComponentTags(src)].filter(tag => !usedOutsideJsxTags(src, tag));
      expect(unresolved, `used in JSX but never imported or declared`).toEqual([]);
    },
  );
});

/**
 * The lint checking itself. Each case below is a way the first version either
 * missed the bug it exists for or rejected valid code; all five were found by
 * an adversarial review, not by writing this file.
 */
describe('the check catches what it claims to', () => {
  const unresolvedIn = (src: string): string[] => {
    const stripped = stripCommentsAndStrings(src);
    return [...jsxComponentTags(stripped)].filter(t => !usedOutsideJsxTags(stripped, t));
  };

  it.each([
    ['the original bug', 'function P() {\n  return <For each={xs}>{x => x}</For>;\n}', ['For']],
    ['a member tag', 'function P() {\n  return <Tabs.Panel>hi</Tabs.Panel>;\n}', ['Tabs']],
    ['after &&', 'function P() {\n  return <div>{ok&&<Missing/>}</div>;\n}', ['Missing']],
    ['after ;', 'function P() {\n  let a;<Gone/>;\n}', ['Gone']],
  ])('should flag %s', (_label, src, expected) => {
    expect(unresolvedIn(src)).toEqual(expected);
  });

  it('should not be talked out of it by a comment', () => {
    // `// a stray mention: const For` used to bind the name.
    const src = 'function P() {\n  // a stray mention: const For\n  return <For each={xs}>{x => x}</For>;\n}';
    expect(unresolvedIn(src)).toEqual(['For']);
  });

  it.each([
    ['an import', "import { For } from 'solid-js';\nfunction P() { return <For each={xs}>{x => x}</For>; }"],
    ['a local declaration', 'function Panel() { return null; }\nfunction P() { return <Panel />; }'],
    ['a parameter', 'function D(Comp: Component) {\n  return <Comp />;\n}'],
    ['a destructured binding', 'const { Panel } = CONSTS;\nfunction P() { return <Panel />; }'],
    ['a type argument, which is not a tag', "const [p] = createSignal<PageId>('summary');"],
  ])('should accept %s', (_label, src) => {
    expect(unresolvedIn(src)).toEqual([]);
  });
});
