import { randomInt } from "node:crypto";

export const RULE_VERSION = "three-coins-1";
export const CONTENT_VERSION = "iching-editorial-1";
export type LineValue = 6 | 7 | 8 | 9;
export interface Round {
  coins: number[];
  value: LineValue;
}
export interface Hexagram {
  number: number;
  chinese: string;
  name: string;
  bits: string;
  keyword: string;
  meaning: string;
}

// King Wen sequence. Bits are ordered from the bottom line to the top line.
// English summaries are original editorial reflections, not translations of the Zhouyi.
const data = [
  [
    "乾",
    "The Creative",
    "111111",
    "Initiative",
    "Bring purpose to your energy. Leadership begins with a clear intention and a willingness to listen.",
  ],
  [
    "坤",
    "The Receptive",
    "000000",
    "Openness",
    "Make room for what is already taking shape. Support, patience and attentive listening can be active strengths.",
  ],
  [
    "屯",
    "Beginning",
    "100010",
    "Emergence",
    "Early growth can feel tangled. Give a new beginning structure and support before expecting it to flourish.",
  ],
  [
    "蒙",
    "The Learner",
    "010001",
    "Curiosity",
    "Let yourself be a beginner. A sincere question and a trusted source can reveal more than a quick conclusion.",
  ],
  [
    "需",
    "Waiting",
    "111010",
    "Readiness",
    "Prepare while the timing remains uncertain. Waiting becomes useful when it nourishes your capacity to act.",
  ],
  [
    "讼",
    "Conflict",
    "010111",
    "Perspective",
    "Notice where opposing needs are hardening into positions. Seek clarity and a fair boundary before escalation.",
  ],
  [
    "师",
    "The Collective",
    "010000",
    "Coordination",
    "Shared effort needs a purpose and responsible leadership. Consider who can help and what each person can carry.",
  ],
  [
    "比",
    "Belonging",
    "000010",
    "Connection",
    "Choose connections that make mutual care possible. Belonging grows through consistent participation.",
  ],
  [
    "小畜",
    "Small Steps",
    "111011",
    "Restraint",
    "A small adjustment may be more useful than a dramatic push. Gather resources and refine what is within reach.",
  ],
  [
    "履",
    "Careful Steps",
    "110111",
    "Awareness",
    "Move with respect for the situation and its boundaries. Confidence works best alongside attention.",
  ],
  [
    "泰",
    "Flow",
    "111000",
    "Exchange",
    "Look for places where effort and support can meet. Healthy exchange depends on keeping communication open.",
  ],
  [
    "否",
    "Standstill",
    "000111",
    "Reassessment",
    "When exchange closes down, protect your energy. A pause can reveal which conditions need to change.",
  ],
  [
    "同人",
    "Shared Purpose",
    "101111",
    "Community",
    "Find common ground without erasing your differences. A meaningful purpose can bring different people together.",
  ],
  [
    "大有",
    "Abundance",
    "111101",
    "Stewardship",
    "Notice what is available and how you use it. Resources become meaningful through thoughtful stewardship.",
  ],
  [
    "谦",
    "Humility",
    "001000",
    "Balance",
    "Recognize your strengths without needing to prove them. Leave space for another perspective.",
  ],
  [
    "豫",
    "Enthusiasm",
    "000100",
    "Momentum",
    "Let inspiration become a practical beginning. Shared enthusiasm needs direction to remain useful.",
  ],
  [
    "随",
    "Following",
    "100110",
    "Adaptation",
    "Pay attention to what deserves your commitment. Following well includes choosing where to place your trust.",
  ],
  [
    "蛊",
    "Repair",
    "011001",
    "Renewal",
    "An old pattern may need patient repair. Begin by naming what has been neglected without assigning blame.",
  ],
  [
    "临",
    "Approach",
    "110000",
    "Presence",
    "Meet a developing situation with warmth and attention. Stay present as possibilities become more tangible.",
  ],
  [
    "观",
    "Contemplation",
    "000011",
    "Observation",
    "Step back to see the wider pattern. Notice what your habits communicate before deciding what to change.",
  ],
  [
    "噬嗑",
    "Working Through",
    "100101",
    "Clarity",
    "Identify the specific obstacle rather than fighting everything at once. Clear agreements can make progress possible.",
  ],
  [
    "贲",
    "Grace",
    "101001",
    "Expression",
    "Let presentation express something real. Beauty is most useful when it supports substance.",
  ],
  [
    "剥",
    "Letting Fall",
    "000001",
    "Release",
    "Notice what no longer supports you. Protect the essentials while an outdated structure falls away.",
  ],
  [
    "复",
    "Return",
    "100000",
    "Restart",
    "A small return to what matters can be enough. Begin again without demanding an immediate transformation.",
  ],
  [
    "无妄",
    "Sincerity",
    "100111",
    "Authenticity",
    "Act from a clear and honest intention. Release the need to control every response or outcome.",
  ],
  [
    "大畜",
    "Stored Strength",
    "111001",
    "Cultivation",
    "Develop your capacity before spending it. Learning and restraint can turn potential into dependable strength.",
  ],
  [
    "颐",
    "Nourishment",
    "100001",
    "Care",
    "Consider what you take in and what you offer. Attention, words and routines all shape what sustains you.",
  ],
  [
    "大过",
    "Great Weight",
    "011110",
    "Pressure",
    "Notice where a structure is carrying too much. Reduce unnecessary strain and ask what support is missing.",
  ],
  [
    "坎",
    "Deep Water",
    "010010",
    "Steadiness",
    "In uncertainty, return to reliable practices. Focus on the next sound step rather than a complete answer.",
  ],
  [
    "离",
    "Clarity",
    "101101",
    "Discernment",
    "Look at what gives your attention direction. Understanding grows when insight stays connected to lived experience.",
  ],
  [
    "咸",
    "Influence",
    "001110",
    "Resonance",
    "Notice how you affect one another. Responsive connection leaves room for both invitation and choice.",
  ],
  [
    "恒",
    "Continuity",
    "011100",
    "Consistency",
    "Consider which commitments remain meaningful over time. Stability comes from responsive consistency.",
  ],
  [
    "遁",
    "Retreat",
    "001111",
    "Boundaries",
    "Stepping back can preserve perspective. Choose a boundary that protects what matters without unnecessary struggle.",
  ],
  [
    "大壮",
    "Great Strength",
    "111100",
    "Responsibility",
    "Use strength with care. Having the energy to act does not remove the need for proportion and consent.",
  ],
  [
    "晋",
    "Progress",
    "000101",
    "Visibility",
    "Let steady contribution become visible. Notice opportunities to share your work without rushing recognition.",
  ],
  [
    "明夷",
    "Guarded Light",
    "101000",
    "Protection",
    "Protect your inner clarity in a difficult setting. You can choose when and where to make yourself visible.",
  ],
  [
    "家人",
    "The Household",
    "101011",
    "Care",
    "Look at the agreements that hold daily life together. Reliable care begins with roles that can be discussed.",
  ],
  [
    "睽",
    "Different Views",
    "110101",
    "Difference",
    "Difference does not require complete disconnection. Find a small area of cooperation while respecting separate needs.",
  ],
  [
    "蹇",
    "Obstruction",
    "001010",
    "Support",
    "An obstacle may call for a different route. Seek perspective and assistance rather than forcing the same approach.",
  ],
  [
    "解",
    "Release",
    "010100",
    "Relief",
    "When tension eases, address what can be resolved. Leave room to move forward without carrying every old burden.",
  ],
  [
    "损",
    "Simplifying",
    "110001",
    "Enough",
    "Reduce what drains attention without serving your purpose. A thoughtful limit can make room for what matters.",
  ],
  [
    "益",
    "Increase",
    "100011",
    "Contribution",
    "Look for growth that benefits more than one person. Useful support and thoughtful effort can reinforce each other.",
  ],
  [
    "夬",
    "Resolution",
    "111110",
    "Honesty",
    "Name what needs to be addressed clearly. Firmness is more effective when it avoids humiliation and aggression.",
  ],
  [
    "姤",
    "Encounter",
    "011111",
    "Discernment",
    "A strong new influence deserves attention and boundaries. You can be curious without surrendering your judgment.",
  ],
  [
    "萃",
    "Gathering",
    "000110",
    "Togetherness",
    "Bring people and resources around a meaningful center. A gathering benefits from clear intentions and inclusion.",
  ],
  [
    "升",
    "Growing Upward",
    "011000",
    "Development",
    "Patient effort can build a foundation. Choose a manageable step and notice what helps it take root.",
  ],
  [
    "困",
    "Constraint",
    "010110",
    "Resilience",
    "Acknowledge limits without treating them as your identity. Preserve essentials and speak honestly about your needs.",
  ],
  [
    "井",
    "The Well",
    "011010",
    "Resources",
    "Return to a dependable source of nourishment or knowledge. Consider how shared resources can remain accessible.",
  ],
  [
    "革",
    "Change",
    "101110",
    "Renewal",
    "Lasting change needs a reason people can understand. Examine what is ready to be replaced and what deserves continuity.",
  ],
  [
    "鼎",
    "The Vessel",
    "011101",
    "Transformation",
    "Consider the environment that turns raw potential into something nourishing. Careful preparation matters.",
  ],
  [
    "震",
    "Awakening",
    "100100",
    "Response",
    "An unexpected moment can interrupt old habits. Regain your footing before deciding how to respond.",
  ],
  [
    "艮",
    "Stillness",
    "001001",
    "Pause",
    "Let attention settle where you are. A deliberate pause can separate a useful response from an automatic reaction.",
  ],
  [
    "渐",
    "Gradual Growth",
    "001011",
    "Patience",
    "Allow trust and progress to develop in stages. A pace you can sustain may matter more than visible speed.",
  ],
  [
    "归妹",
    "Uneven Ground",
    "110100",
    "Alignment",
    "Examine whether expectations and commitments are balanced. Make room to discuss what each person actually wants.",
  ],
  [
    "丰",
    "Fullness",
    "101100",
    "Appreciation",
    "Give attention to what is present while it is here. Fullness benefits from appreciation and sensible limits.",
  ],
  [
    "旅",
    "The Traveler",
    "001101",
    "Adaptability",
    "Move through an unfamiliar setting with care. Stay curious, travel lightly and respect local boundaries.",
  ],
  [
    "巽",
    "Gentle Influence",
    "011011",
    "Persistence",
    "Small, consistent influences can reshape a pattern. Choose words and actions you can repeat with integrity.",
  ],
  [
    "兑",
    "Shared Joy",
    "110110",
    "Expression",
    "Make space for honest conversation and shared enjoyment. Warmth grows when expression is also attentive.",
  ],
  [
    "涣",
    "Dispersal",
    "010011",
    "Reconnection",
    "Loosen what has become rigid or isolated. A shared purpose can help scattered attention find connection.",
  ],
  [
    "节",
    "Healthy Limits",
    "110010",
    "Boundaries",
    "Choose limits that support life rather than punish it. A clear agreement can protect both freedom and care.",
  ],
  [
    "中孚",
    "Inner Truth",
    "110011",
    "Trust",
    "Bring your words and intentions into alignment. Trust grows through honesty that is matched by behavior.",
  ],
  [
    "小过",
    "Small Attention",
    "001100",
    "Details",
    "Give care to the small things. A modest, attentive step may fit the moment better than an ambitious leap.",
  ],
  [
    "既济",
    "After Completion",
    "101010",
    "Maintenance",
    "A completed step still needs attention. Notice what will keep a new balance healthy and workable.",
  ],
  [
    "未济",
    "Before Completion",
    "010101",
    "Possibility",
    "An unfinished situation still holds possibilities. Stay attentive to the crossing rather than declaring the journey over.",
  ],
] as const;

export const HEXAGRAMS: Hexagram[] = data.map(
  ([chinese, name, bits, keyword, meaning], i) => ({
    number: i + 1,
    chinese,
    name,
    bits,
    keyword,
    meaning,
  }),
);
const byBits = new Map(HEXAGRAMS.map((h) => [h.bits, h]));
export function tossCoins(): Round {
  const coins = Array.from({ length: 3 }, () => randomInt(2) + 2);
  return { coins, value: coins.reduce((a, b) => a + b, 0) as LineValue };
}
export function interpretLines(values: readonly number[]) {
  if (values.length !== 6 || values.some((v) => ![6, 7, 8, 9].includes(v)))
    throw new Error("Six valid lines are required");
  const bits = values.map((v) => (v % 2 ? "1" : "0")).join("");
  const changed = values
    .map((v) => (v === 6 ? "1" : v === 9 ? "0" : v % 2 ? "1" : "0"))
    .join("");
  const moving = values.flatMap((v, i) => (v === 6 || v === 9 ? [i + 1] : []));
  return {
    ruleVersion: RULE_VERSION,
    contentVersion: CONTENT_VERSION,
    lines: [...values],
    primary: byBits.get(bits)!,
    transformation: moving.length ? byBits.get(changed)! : null,
    moving,
  };
}
export type Basis = ReturnType<typeof interpretLines>;
export const METHOD = {
  name: "I Ching · three-coin method",
  ruleVersion: RULE_VERSION,
  contentVersion: CONTENT_VERSION,
  explanation:
    "Three independent coins are cast six times. One side counts 2, the other 3. Lines build from bottom to top. Values 6 and 9 change; 7 and 8 remain. Without moving lines, there is no separate transformed hexagram.",
  interpretation:
    "We explore the primary hexagram, every moving position in context, and the transformed hexagram when present. We do not select an auspicious outcome or apply a Na Jia prediction system. The English reflections are original modern editorial writing, not literal translations of ancient line texts.",
  sources: [
    {
      title: "Zhouyi · Chinese source text",
      url: "https://ctext.org/book-of-changes",
    },
    {
      title: "Three-coin casting method",
      url: "https://zhouyi.dk/the-coin-method",
    },
  ],
};
