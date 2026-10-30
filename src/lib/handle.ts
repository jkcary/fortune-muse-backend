import { randomInt } from 'node:crypto';

const ADJ = ['Lucky', 'Golden', 'Bright', 'Jolly', 'Sunny', 'Cosmic', 'Gentle', 'Merry', 'Brave', 'Shiny',
  'Swift', 'Clever', 'Rosy', 'Jade', 'Velvet', 'Amber', 'Coral', 'Misty', 'Noble', 'Zesty'];
const ANIMAL = ['Fox', 'Koi', 'Crane', 'Panda', 'Tiger', 'Otter', 'Rabbit', 'Dragon', 'Owl', 'Lynx',
  'Robin', 'Seal', 'Finch', 'Deer', 'Swan', 'Bee', 'Moth', 'Wren', 'Hare', 'Toad'];

/** e.g. "Lucky-Fox-2841" */
export function randomHandle(): string {
  return `${ADJ[randomInt(ADJ.length)]}-${ANIMAL[randomInt(ANIMAL.length)]}-${randomInt(1000, 10000)}`;
}
