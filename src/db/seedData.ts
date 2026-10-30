/** Launch content. Ops can edit all of this from the admin console after seeding. */

export const DEITIES = [
  {
    id: 'master-bao',
    name: 'Master Bao',
    title: 'Keeper of the Golden Ingot',
    theme: 'ingot',
    sort: 1,
    greeting: 'Ah, a new face at my door. Sit, sit — let us see what fortune is brewing for you today.',
    persona_prompt:
      'You are Master Bao, an original, fictional fortune deity shaped like a gleaming gold ingot. You are warm, unhurried and grandfatherly, ' +
      'fond of tea and small proverbs you make up yourself. You speak in short, kind sentences and never lecture.',
    image_assets: { primary: '#F5B700', secondary: '#B8860B', emoji: '🪙' },
  },
  {
    id: 'nugget-nell',
    name: 'Nugget Nell',
    title: 'Prospector of Small Fortunes',
    theme: 'nugget',
    sort: 2,
    greeting: "Well howdy! Every day's got a little gold in it if you know where to dig. Let's find yours.",
    persona_prompt:
      'You are Nugget Nell, an original, fictional fortune deity shaped like a bright gold nugget. You are upbeat, playful and practical, ' +
      'with a light frontier twang. You love tiny wins and concrete next steps.',
    image_assets: { primary: '#FFC94D', secondary: '#C77700', emoji: '✨' },
  },
  {
    id: 'sir-greenleaf',
    name: 'Sir Greenleaf',
    title: 'Spirit of the Crisp Green Bill',
    theme: 'greenback',
    sort: 3,
    greeting: 'Good day to you. I have folded myself neatly for the occasion. Shall we consult the ledger of luck?',
    persona_prompt:
      'You are Sir Greenleaf, an original, fictional fortune deity shaped like a crisp green paper bill. You are dapper, witty and gently ' +
      'dramatic, like a theatre host. You keep your humor kind and your advice tidy.',
    image_assets: { primary: '#3FA66B', secondary: '#1E6B43', emoji: '💵' },
  },
];

// Weights are shown to users as percentages on the draw page (plan §M6).
export const REWARDS = [
  { id: 'free-reading', type: 'free_reading', name: 'Free Reading Voucher', description: 'One standard reading on the house.', weight: 5, asset: '🎟️' },
  { id: 'hat-red-envelope', type: 'avatar_item', name: 'Red Envelope Hat', description: 'A jaunty hat for your avatar.', weight: 12, asset: 'hat-red' },
  { id: 'glasses-gold', type: 'avatar_item', name: 'Gold Rim Glasses', description: 'Very distinguished.', weight: 12, asset: 'glasses-gold' },
  { id: 'bg-lantern', type: 'avatar_item', name: 'Lantern Night Background', description: 'A glowing lantern backdrop.', weight: 10, asset: 'bg-lantern' },
  { id: 'skin-bao-jade', type: 'deity_skin', name: 'Jade Master Bao', description: 'Master Bao in polished jade.', weight: 6, asset: 'skin-bao-jade' },
  { id: 'skin-nell-rose', type: 'deity_skin', name: 'Rose Gold Nell', description: 'Nugget Nell in rose gold.', weight: 6, asset: 'skin-nell-rose' },
  { id: 'sticker-koi', type: 'sticker', name: 'Lucky Koi Sticker', description: 'For the group chat.', weight: 17, asset: '🐟' },
  { id: 'sticker-clover', type: 'sticker', name: 'Four-Leaf Sticker', description: 'For the group chat.', weight: 16, asset: '🍀' },
  { id: 'sticker-sparkle-heart', type: 'sticker', name: 'Sparkle Heart Sticker', description: 'For the group chat.', weight: 16, asset: '💖' },
];

const song = (title: string, artist: string, topic: 'wealth' | 'love' | null) => ({ kind: 'song', topic, data: { title, artist } });
const item = (kind: string, topic: 'wealth' | 'love' | null, data: Record<string, unknown>) => ({ kind, topic, data });

export const CONTENT = [
  song('Here Comes the Sun', 'The Beatles', null),
  song('Lovely Day', 'Bill Withers', null),
  song('Walking on Sunshine', 'Katrina and the Waves', null),
  song('September', 'Earth, Wind & Fire', null),
  song('Mr. Blue Sky', 'Electric Light Orchestra', null),
  song('Feeling Good', 'Nina Simone', null),
  song("Don't Stop Me Now", 'Queen', 'wealth'),
  song('Eye of the Tiger', 'Survivor', 'wealth'),
  song('Good Days', 'SZA', 'wealth'),
  song('Best Day of My Life', 'American Authors', 'wealth'),
  song('Rich Girl', 'Hall & Oates', 'wealth'),
  song('Happy', 'Pharrell Williams', 'wealth'),
  song('At Last', 'Etta James', 'love'),
  song('L-O-V-E', 'Nat King Cole', 'love'),
  song('Adore You', 'Harry Styles', 'love'),
  song('Put Your Records On', 'Corinne Bailey Rae', 'love'),
  song('Sunday Morning', 'Maroon 5', 'love'),
  song('Just the Way You Are', 'Bruno Mars', 'love'),

  ...['Matcha latte', 'Cold brew with oat milk', 'Jasmine green tea', 'Fresh-squeezed orange juice', 'Sparkling water with lime',
    'Chai latte', 'Hibiscus iced tea', 'Ginger lemon tea', 'Mango lassi', 'Strawberry banana smoothie', 'Chrysanthemum tea', 'Coconut water',
    'Honey oolong tea', 'Peach iced tea', 'Hot cocoa with cinnamon'].map((name) => item('drink', null, { name })),

  ...['Pan-fried dumplings', 'Longevity noodles', 'Avocado toast with chili flakes', 'Citrus and fennel salad', 'Salmon rice bowl',
    'Blueberry pancakes', 'Tomato basil soup', 'Sweet potato fries', 'Peach yogurt bowl', 'Steamed pork buns', 'Veggie fried rice',
    'Chicken tortilla soup', 'Golden corn on the cob', 'Lemon garlic shrimp', 'Mushroom risotto'].map((name) => item('food', null, { name })),

  ...[['Tailored blazer', 'navy'], ['Crewneck sweater', 'gold'], ['Button-down shirt', 'crisp white'], ['Wrap dress', 'emerald green'],
    ['Denim jacket', 'light wash'], ['Knit cardigan', 'warm red'], ['Linen shirt', 'sage green'], ['Turtleneck', 'camel']]
    .map(([style, color]) => item('outfit', null, { style, color })),

  ...[['Loafers', 'brown'], ['White sneakers', 'white'], ['Ankle boots', 'black'], ['Canvas slip-ons', 'red'],
    ['Ballet flats', 'blush pink'], ['Running shoes', 'gray']].map(([style, color]) => item('shoes', null, { style, color })),

  ...['olive', 'charcoal gray', 'neon orange', 'mustard', 'deep purple', 'beige'].map((name) => item('color', null, { name })),

  // Lucky actions follow Appendix A: one concrete, verifiable action that can be done today.
  ...[
    'Before 3 p.m. today, rename the oldest untouched folder on your desktop to a name of exactly three words.',
    'Before noon today, write down your three largest expenses from last week on one sheet of paper.',
    'Today, move one $5 bill or coin from your wallet into a jar and label the jar with a goal of five words or fewer.',
    'Before 6 p.m. today, unsubscribe from two marketing emails in your inbox.',
    'Today, send one message to a former coworker that contains exactly one specific compliment.',
    'Before you eat lunch today, delete five photos of receipts or screenshots from your phone.',
    'Today, add one line to your résumé or profile describing a result you achieved this year, with a number in it.',
    'Before 8 p.m. today, check the balance of one account you have not looked at this month.',
  ].map((text) => item('action', 'wealth', { text })),
  ...[
    'Before 9 p.m. today, send one text to someone you care about that begins with "I remembered".',
    'Today, write the name of one person you are grateful for on a sticky note and put it on your mirror.',
    'Before noon today, compliment one stranger on one specific item they are wearing.',
    'Today, make your bed and place one object that is red on top of the pillow.',
    'Before 7 p.m. today, write three things you like about yourself in your phone notes, each under ten words.',
    'Today, ask one friend a question about their week and wait for their full answer before replying.',
    'Before bed tonight, put your phone in another room for 20 minutes and read 10 pages of any book.',
    'Today, return one message you have left unanswered for more than three days.',
  ].map((text) => item('action', 'love', { text })),
];
