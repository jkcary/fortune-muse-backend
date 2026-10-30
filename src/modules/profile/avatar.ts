import { randomInt } from 'node:crypto';

// Free customization options (plan §M2: 20–30 free options).
export const AVATAR_OPTIONS = {
  base: ['fox', 'cat', 'panda', 'rabbit', 'koi', 'owl'],
  palette: ['gold', 'jade', 'coral', 'sky', 'plum', 'mint', 'peach', 'ink'],
  accessory: ['none', 'scarf', 'flower', 'bow', 'headphones', 'star-pin'],
  background: ['sunrise', 'clouds', 'bamboo', 'night', 'confetti', 'plain'],
} as const;

// Items unlocked through the daily draw.
export const UNLOCKABLE_ACCESSORIES = ['hat-red', 'glasses-gold'];
export const UNLOCKABLE_BACKGROUNDS = ['bg-lantern'];

export const MOODS = ['happy', 'calm', 'low', 'surprised', 'hopeful'] as const;
export type Mood = (typeof MOODS)[number];

const pick = <T>(xs: readonly T[]) => xs[randomInt(xs.length)];

export function randomAvatar() {
  return {
    base_id: pick(AVATAR_OPTIONS.base),
    customization: { palette: pick(AVATAR_OPTIONS.palette), accessory: 'none', background: pick(AVATAR_OPTIONS.background) },
  };
}
