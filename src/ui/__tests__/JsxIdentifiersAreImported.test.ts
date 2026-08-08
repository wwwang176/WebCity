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
 * Capitalised opening tags — `<For`, `<Show`, `<MyPanel`. Lowercase tags are
 * host elements.
 *
 * The leading-character class is what separates a tag from a type argument:
 * `createSignal<PageId>('summary')` has an identifier immediately before the
 * `<`, whereas a JSX tag always follows whitespace, a bracket or an operator.
 */
function jsxComponentTags(src: string): Set<string> {
  const found = new Set<string>();
  for (const m of src.matchAll(/(?:^|[\s(\[{=>,?:])<([A-Z][A-Za-z0-9_]*)[\s/>]/gm)) found.add(m[1]!);
  return found;
}

/**
 * Every name the module can resolve: imports, and anything declared at any
 * depth in the file. Over-approximating is the right direction — this test
 * must never fail on a name that does resolve.
 */
function boundNames(src: string): Set<string> {
  const names = new Set<string>();
  for (const m of src.matchAll(/^import\s+(?:type\s+)?([^;]+?)\s+from\s+['"]/gm)) {
    for (const part of m[1]!.replace(/[{}]/g, ',').split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name.replace(/^\*\s*/, ''));
    }
  }
  for (const m of src.matchAll(/\b(?:function|class|const|let|var|type|interface)\s+([A-Z][A-Za-z0-9_]*)/g)) {
    names.add(m[1]!);
  }
  return names;
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
      const src = readFileSync(file, 'utf8');
      const bound = boundNames(src);
      const unresolved = [...jsxComponentTags(src)].filter(tag => !bound.has(tag));
      expect(unresolved, `used in JSX but never imported or declared`).toEqual([]);
    },
  );
});
