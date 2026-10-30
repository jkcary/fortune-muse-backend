export type Topic = 'wealth' | 'love';
export type Tier = 'standard' | 'detailed' | 'deep';

/** USD cents. US launch: prices shown before sales tax; Stripe Tax adds it at checkout where it applies. */
export const PRICES: Record<Tier, { amount: number; label: string; description: string }> = {
  standard: { amount: 300, label: 'Standard', description: 'Your full daily fortune card.' },
  detailed: { amount: 400, label: 'Detailed', description: 'Adds a longer answer and your lucky hour.' },
  deep: { amount: 500, label: 'Deep', description: 'Adds three reflection prompts to carry through the day.' },
};

export const QUESTION_TEMPLATES: Record<Topic, string[]> = {
  wealth: [
    'Is this a good week to ask for a raise?',
    'Should I start my side project this month?',
    'How can I feel calmer about money right now?',
    'What should I focus on in my job search?',
  ],
  love: [
    'Will my crush notice me?',
    'Should I reach out to my ex?',
    'How can I open up more in my relationship?',
    'Where should I look to meet someone new?',
  ],
};

/**
 * Same-question room matching (plan §M7). MVP uses keyword clusters per topic; each cluster
 * becomes one room per day (split at 50 members). A pgvector similarity matcher can replace
 * `clusterQuestion` later without changing the room service.
 */
export const CLUSTERS: Record<Topic, { id: string; label: string; keywords: RegExp }[]> = {
  wealth: [
    { id: 'raise', label: 'Raises & promotions', keywords: /\b(raise|promotion|promoted|salary|pay ?rise|bonus|boss|review)\b/i },
    { id: 'job', label: 'Job search & career moves', keywords: /\b(job|interview|career|hired|hiring|resume|résumé|quit|offer|layoff|laid off|work)\b/i },
    { id: 'business', label: 'Side projects & business', keywords: /\b(side ?(hustle|project)|business|startup|launch|customers?|shop|etsy|freelanc\w*|clients?)\b/i },
    { id: 'debt', label: 'Debt & saving', keywords: /\b(debt|loan|credit card|sav(e|ing|ings)|budget|rent|bills?|mortgage)\b/i },
    { id: 'invest', label: 'Investing & windfalls', keywords: /\b(invest\w*|stocks?|crypto|bitcoin|lottery|market|trading|shares)\b/i },
  ],
  love: [
    { id: 'crush', label: 'Crushes', keywords: /\b(crush|like me|notice me|ask (him|her|them) out|flirt\w*)\b/i },
    { id: 'ex', label: 'Exes & breakups', keywords: /\b(ex|breakup|broke up|break up|get back|move on|closure)\b/i },
    { id: 'relationship', label: 'Growing a relationship', keywords: /\b(relationship|partner|boyfriend|girlfriend|husband|wife|marri\w*|engag\w*|commit\w*|fight|argue)\b/i },
    { id: 'dating', label: 'Dating & meeting someone', keywords: /\b(dating|date|apps?|single|meet (someone|people)|tinder|hinge|bumble|soulmate|the one)\b/i },
    { id: 'self', label: 'Self-love & confidence', keywords: /\b(confiden\w*|self[- ]?love|lonely|alone|worth|insecur\w*)\b/i },
  ],
};

export function clusterQuestion(topic: Topic, question: string): { id: string; label: string } {
  const hit = CLUSTERS[topic].find((c) => c.keywords.test(question));
  if (hit) return { id: hit.id, label: hit.label };
  return { id: 'general', label: topic === 'wealth' ? 'Money luck in general' : 'Love luck in general' };
}

export const DIRECTIONS = ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'] as const;
