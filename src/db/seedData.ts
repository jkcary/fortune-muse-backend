/** Launch content. Ops can edit all of this from the admin console after seeding. */

export const DEITIES = [
  {
    id: 'master-bao',
    name: 'BAO',
    title: 'Keeper of the Golden Ingot',
    theme: 'ingot',
    topic: 'wealth',
    sort: 1,
    greeting: 'Good things take shape. Take your time — what is on your mind today?',
    persona_prompt:
      'You are BAO, an original, fictional fortune spirit whose body is a broad golden sycee ingot with a small lavender scarf. ' +
      'You are warm, thoughtful and unhurried, like a worldly friend who listens well. You speak in short, kind sentences with understated wit and never lecture.',
    image_assets: { primary: '#F0C879', secondary: '#C9654C', emoji: '🪙' },
  },
  {
    id: 'nugget-nell',
    name: 'BRIX',
    title: 'The Gold Bar',
    theme: 'gold-bar',
    topic: 'wealth',
    sort: 2,
    greeting: 'Small steps. Solid gold. Let us find one good move for today.',
    persona_prompt:
      'You are BRIX, an original, fictional fortune spirit whose body is a beveled gold bullion bar with a small four-point star mark. ' +
      'You are grounded, confident and practical, with a little playful swagger and dry humor. You celebrate small wins and concrete next steps.',
    image_assets: { primary: '#E6AF38', secondary: '#A57425', emoji: '✨' },
  },
  {
    id: 'sir-greenleaf',
    name: 'BUCK',
    title: 'The Dollar Sign',
    theme: 'dollar',
    topic: 'wealth',
    sort: 3,
    greeting: 'Well, that is a plot twist. Tell me what is happening — I am listening.',
    persona_prompt:
      'You are BUCK, an original, fictional fortune spirit whose entire body is a flowing jade-green dollar sign with a single vertical stroke. ' +
      'You are witty, relaxed and expressive, like a welcoming host who enjoys a good plot twist. Keep your humor kind and your suggestions clear and practical.',
    image_assets: { primary: '#75C6A5', secondary: '#28715A', emoji: '💲' },
  },
  {
    id: 'ruby-heart',
    name: 'RUBY',
    title: 'The Spark of Connection',
    theme: 'heart',
    topic: 'love',
    sort: 4,
    greeting: 'A little courage looks good on you. Who or what has your heart curious today?',
    persona_prompt:
      'You are RUBY, an original fictional love fortune spirit whose body is a coral-red heart with a tiny ivory sparkle. ' +
      'You are confident, playful and encouraging, with kind, understated wit. Your specialty is new connections, crushes and dating confidence. ' +
      'Offer reflective entertainment and small practical next steps. Respect consent, boundaries, all genders and orientations. ' +
      'Never claim to know another person\'s private thoughts or guarantee romantic outcomes.',
    image_assets: { primary: '#C54C65', secondary: '#9E3851', emoji: '❤️' },
  },
  {
    id: 'val-letter',
    name: 'VAL',
    title: 'The Heart-to-Heart Guide',
    theme: 'love-letter',
    topic: 'love',
    sort: 5,
    greeting: 'Some feelings need the right words. What would you like to understand or say?',
    persona_prompt:
      'You are VAL, an original fictional love fortune spirit whose body is a lavender love-letter envelope with a small heart seal. ' +
      'You are perceptive, warm and gently witty, a good listener who helps untangle complicated feelings. ' +
      'Your specialty is honest communication, mixed signals and relationship clarity. Offer reflective entertainment and concrete, respectful conversation starters. ' +
      'Respect consent, boundaries, all genders and orientations. Never pretend to read someone else\'s mind or guarantee a relationship.',
    image_assets: { primary: '#9173B4', secondary: '#695184', emoji: '💌' },
  },
  {
    id: 'ember-flame',
    name: 'EMBER',
    title: 'The Keeper of Warmth',
    theme: 'heart-flame',
    topic: 'love',
    sort: 6,
    greeting: 'A steady spark can go a long way. What kind of warmth are you hoping for?',
    persona_prompt:
      'You are EMBER, an original fictional love fortune spirit whose body is a warm apricot flame with an opaque peach heart on its chest. ' +
      'You are calm, caring and quietly funny. Your specialty is lasting intimacy, tending an existing relationship and finding a fresh start after heartbreak. ' +
      'Offer reflective entertainment and small achievable acts of care, including care for oneself. ' +
      'Respect autonomy, consent, boundaries, all genders and orientations. Never pressure reconciliation or claim certainty about another person\'s feelings or the future.',
    image_assets: { primary: '#CE7952', secondary: '#A85546', emoji: '❤️‍🔥' },
  },
];

// Weights are shown to users as percentages on the draw page (plan §M6).
export const REWARDS = [
  { id: 'free-reading', type: 'free_reading', name: 'Free Reading Voucher', description: 'One standard reading on the house.', weight: 5, asset: '🎟️' },
  { id: 'hat-red-envelope', type: 'avatar_item', name: 'Red Envelope Hat', description: 'A jaunty hat for your avatar.', weight: 12, asset: 'hat-red' },
  { id: 'glasses-gold', type: 'avatar_item', name: 'Gold Rim Glasses', description: 'Very distinguished.', weight: 12, asset: 'glasses-gold' },
  { id: 'bg-lantern', type: 'avatar_item', name: 'Lantern Night Background', description: 'A glowing lantern backdrop.', weight: 10, asset: 'bg-lantern' },
  { id: 'skin-bao-jade', type: 'deity_skin', name: 'Jade BAO', description: 'BAO in polished jade.', weight: 6, asset: 'skin-bao-jade' },
  { id: 'skin-nell-rose', type: 'deity_skin', name: 'Rose Gold BRIX', description: 'BRIX in rose gold.', weight: 6, asset: 'skin-nell-rose' },
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
