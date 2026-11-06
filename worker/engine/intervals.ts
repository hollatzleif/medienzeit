// Halboffene Intervalle [von, bis) in Millisekunden.
export type Iv = [number, number];

export function normalize(list: Iv[]): Iv[] {
  const s = list.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Iv[] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export const union = (...lists: Iv[][]): Iv[] => normalize(lists.flat().map(([a, b]) => [a, b] as Iv));

export function intersect(x: Iv[], y: Iv[]): Iv[] {
  const a = normalize(x.map((i) => [...i] as Iv));
  const b = normalize(y.map((i) => [...i] as Iv));
  const out: Iv[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i][0], b[j][0]);
    const hi = Math.min(a[i][1], b[j][1]);
    if (hi > lo) out.push([lo, hi]);
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return out;
}

export function subtract(x: Iv[], y: Iv[]): Iv[] {
  const b = normalize(y.map((i) => [...i] as Iv));
  const out: Iv[] = [];
  for (const [s, e] of normalize(x.map((i) => [...i] as Iv))) {
    let cur = s;
    for (const [bs, be] of b) {
      if (be <= cur) continue;
      if (bs >= e) break;
      if (bs > cur) out.push([cur, bs]);
      cur = Math.max(cur, be);
      if (cur >= e) break;
    }
    if (cur < e) out.push([cur, e]);
  }
  return out;
}

export const clip = (x: Iv[], from: number, to: number) => intersect(x, [[from, to]]);

export const contains = (x: Iv[], t: number) => x.some(([a, b]) => a <= t && t < b);

export const total = (x: Iv[]) => x.reduce((s, [a, b]) => s + (b - a), 0);
