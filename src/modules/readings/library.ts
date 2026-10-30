import { randomInt } from 'node:crypto';
import { many, pool } from '../../db/pool.js';
import type { Topic } from './catalog.js';

export interface Library {
  songs: { title: string; artist: string }[];
  drinks: string[];
  foods: string[];
  outfits: { style: string; color: string }[];
  shoes: { style: string; color: string }[];
  colors: string[];
  actions: string[];
}

function sample<T>(xs: T[], n: number): T[] {
  const copy = [...xs];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

/** A small random slice of the content library; the model picks from it so results stay on-brand and cheap. */
export async function sampleLibrary(topic: Topic, n = 5): Promise<Library> {
  const rows = await many<{ kind: string; data: any }>(pool,
    'SELECT kind, data FROM content_items WHERE active AND (topic IS NULL OR topic=$1)', [topic]);
  const of = (k: string) => rows.filter((r) => r.kind === k).map((r) => r.data);
  return {
    songs: sample(of('song'), n),
    drinks: sample(of('drink').map((d) => d.name), n),
    foods: sample(of('food').map((d) => d.name), n),
    outfits: sample(of('outfit'), n),
    shoes: sample(of('shoes'), n),
    colors: sample(of('color').map((d) => d.name), n),
    actions: sample(of('action').map((d) => d.text), n),
  };
}

export function musicLinks(song: { title: string; artist: string }) {
  const q = encodeURIComponent(`${song.title} ${song.artist}`);
  return {
    ...song,
    spotifyUrl: `https://open.spotify.com/search/${q}`,
    appleMusicUrl: `https://music.apple.com/us/search?term=${q}`,
  };
}
