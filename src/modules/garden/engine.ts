/** Versioned, deterministic light puzzles shared with the client. No reading data. */
export const GARDEN_VERSION = 1;
export const DIRECTIONS = [1, 2, 4, 8] as const; // north, east, south, west
export interface GardenTile {
  mask: number;
  fixed: boolean;
  star: boolean;
}
export interface GardenLevel {
  id: number;
  size: number;
  source: number;
  goal: number;
  tiles: GardenTile[];
  initial: number[];
  theme: string;
}
export interface GardenState {
  completed: number[];
  decor: string[];
  momentCount: number;
  todayKind: string | null;
  today: string;
}
export const DECOR = [
  { id: "moon-lamp", at: 1, label: "Moon lantern" },
  { id: "star-flowers", at: 3, label: "Star flowers" },
  { id: "pearl-fountain", at: 5, label: "Pearl fountain" },
  { id: "moon-bridge", at: 7, label: "Moon bridge" },
  { id: "wind-chimes", at: 9, label: "Wind chimes" },
  { id: "observatory", at: 12, label: "Little observatory" },
] as const;
export function rotateMask(mask: number, turns: number) {
  const n = ((turns % 4) + 4) % 4;
  return ((mask << n) | (mask >> (4 - n))) & 15;
}
const paths = [
  [0, 1, 5, 6, 10, 11, 15],
  [0, 4, 5, 9, 10, 14, 15],
  [0, 1, 2, 6, 5, 9, 13, 14, 15],
  [0, 4, 8, 9, 5, 6, 7, 11, 15],
  [0, 1, 5, 4, 8, 12, 13, 9, 10, 11, 15],
  [0, 4, 5, 1, 2, 6, 10, 9, 13, 14, 15],
  [0, 1, 6, 7, 12, 13, 18, 19, 24],
  [0, 5, 10, 11, 6, 7, 8, 13, 18, 23, 24],
  [0, 1, 2, 7, 6, 11, 16, 17, 12, 13, 14, 19, 24],
  [0, 5, 6, 1, 2, 3, 8, 7, 12, 17, 18, 19, 24],
  [0, 1, 6, 5, 10, 15, 16, 11, 12, 7, 8, 13, 18, 23, 24],
  [0, 5, 10, 11, 6, 7, 2, 3, 8, 9, 14, 13, 18, 17, 22, 23, 24],
];
function direction(from: number, to: number, size: number) {
  if (to === from - size) return 0;
  if (to === from + 1 && Math.floor(to / size) === Math.floor(from / size))
    return 1;
  if (to === from + size) return 2;
  if (to === from - 1 && Math.floor(to / size) === Math.floor(from / size))
    return 3;
  throw new Error("Invalid puzzle edge");
}
function createLevel(path: number[], i: number): GardenLevel {
  const size = i < 6 ? 4 : 5;
  const tiles: GardenTile[] = Array.from({ length: size * size }, (_, j) => ({
    mask: (j + i) % 3 === 0 ? 0 : j % 2 ? 3 : 5,
    fixed: false,
    star: false,
  }));
  const used = new Set(path);
  for (const p of path) tiles[p].mask = 0;
  for (let j = 1; j < path.length; j++) {
    const a = path[j - 1],
      b = path[j],
      d = direction(a, b, size);
    tiles[a].mask |= 1 << d;
    tiles[b].mask |= 1 << ((d + 2) % 4);
  }
  tiles[path[0]].mask |= 8;
  tiles[path.at(-1)!].mask |= 2;
  tiles[path[0]].fixed = tiles[path.at(-1)!].fixed = true;
  tiles[path[Math.floor(path.length / 3)]].star = true;
  if (i > 1) tiles[path[Math.floor((path.length * 2) / 3)]].star = true;
  if (i > 3) tiles[path[Math.floor(path.length / 2)]].fixed = true;
  // A side lantern requires a genuine split, not just reaching the exit.
  if (i >= 7) {
    outer: for (const p of path.slice(2, -2)) {
      for (const [d, next] of [p - size, p + 1, p + size, p - 1].entries()) {
        if (
          next < 0 ||
          next >= size * size ||
          used.has(next) ||
          (d % 2 === 1 && Math.floor(next / size) !== Math.floor(p / size))
        )
          continue;
        tiles[p].mask |= 1 << d;
        tiles[next] = { mask: 1 << ((d + 2) % 4), fixed: false, star: true };
        break outer;
      }
    }
  }
  const initial = tiles.map((tile, j) =>
    tile.fixed || !tile.mask ? 0 : ((i * 7 + j * 3) % 3) + 1,
  );
  return {
    id: i + 1,
    size,
    source: path[0],
    goal: path.at(-1)!,
    tiles,
    initial,
    theme: ["Water", "Mountain", "Thunder", "Wind"][Math.floor(i / 3)],
  };
}
export const GARDEN_LEVELS = paths.map(createLevel);
export function lightState(level: GardenLevel, rotations: number[]) {
  if (
    rotations.length !== level.tiles.length ||
    rotations.some(
      (r, i) =>
        !Number.isInteger(r) ||
        r < 0 ||
        r > 3 ||
        (level.tiles[i].fixed && r !== 0),
    )
  )
    return { lit: [] as number[], solved: false, stars: 0 };
  const masks = level.tiles.map((tile, i) =>
    rotateMask(tile.mask, rotations[i]),
  );
  const seen = new Set<number>([level.source]);
  const queue = [level.source];
  while (queue.length) {
    const p = queue.shift()!;
    const neighbors = [p - level.size, p + 1, p + level.size, p - 1];
    for (let d = 0; d < 4; d++) {
      const next = neighbors[d];
      if (
        next < 0 ||
        next >= masks.length ||
        (d % 2 === 1 &&
          Math.floor(next / level.size) !== Math.floor(p / level.size))
      )
        continue;
      if (
        masks[p] & (1 << d) &&
        masks[next] & (1 << ((d + 2) % 4)) &&
        !seen.has(next)
      ) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  const stars = level.tiles.filter((t, i) => t.star && seen.has(i)).length;
  return {
    lit: [...seen],
    stars,
    solved:
      seen.has(level.goal) &&
      level.tiles.every((t, i) => !t.star || seen.has(i)),
  };
}
export function hintTile(level: GardenLevel, rotations: number[]) {
  if (lightState(level, rotations).solved) return -1;
  return level.tiles.findIndex(
    (t, i) => !t.fixed && t.mask && rotateMask(t.mask, rotations[i]) !== t.mask,
  );
}
export function earnedDecor(completed: number[]) {
  return DECOR.filter((d) => completed.length >= d.at);
}
