/** Public v2 API contract. Sync to the frontend with npm run contracts:sync. */
export interface Hexagram {
  number: number;
  chinese: string;
  name: string;
  bits: string;
  keyword: string;
  meaning: string;
}
export interface Basis {
  ruleVersion: string;
  contentVersion: string;
  lines: number[];
  primary: Hexagram;
  transformation: Hexagram | null;
  moving: number[];
}
export interface OracleDoor {
  id: "a" | "b";
  title: string;
  perspective: string;
  tradeoff: string;
  experiment: string;
}
export interface OracleGlimpse {
  language: "en-US" | "en-GB" | "zh-Hans" | "zh-Hant";
  reflection: string;
  question: string;
  doors: [OracleDoor, OracleDoor];
  aiGenerated: boolean;
  generator: string;
}
export type JourneyStatus = "planned" | "tried" | "waiting" | "paused";
export interface OracleDoorExerciseContent {
  version: 1;
  door: "a" | "b";
  language: OracleGlimpse["language"];
  priorityQuestion: string;
  priorities: { id: string; label: string }[];
  costQuestion: string;
  costs: { id: string; label: string }[];
  reflections: { priority: string; cost: string; summary: string; prompt: string; generator: string }[];
  aiGenerated: true;
  generator: string;
}
export interface OracleReturnPreferences {
  currentCastId: string | null;
}
export interface OracleJourney {
  selectedDoor: "a" | "b" | null;
  feedback: "fits" | "misses" | null;
  action: string;
  actionNotes?: string;
  followUpEnabled: boolean;
  status: JourneyStatus;
  doorExercise?: { version?: 1; door: "a" | "b"; priority: string; cost: string };
  updates: {
    id: string;
    text: string;
    status: JourneyStatus;
    kind?: "status" | "changed";
    createdAt: string;
  }[];
}
export interface OracleCast {
  id: string;
  version: 2;
  topic: "wealth" | "love";
  question: string;
  context: string;
  privateMode: boolean;
  rounds: { coins: number[]; value: number }[];
  basis: Basis | null;
  createdAt: string;
  updatedAt?: string;
  expiresAt: string | null;
  saved: boolean;
  favorite: boolean;
  note: string;
  glimpse: OracleGlimpse | null;
  doorExerciseContent?: OracleDoorExerciseContent | null;
  journey: OracleJourney | null;
  premiumStatus:
    | "free"
    | "awaiting_payment"
    | "queued"
    | "generating"
    | "ready"
    | "failed"
    | "refunding"
    | "refunded";
  premium: {
    headline: string;
    interpretation: string;
    changing: string;
    action: string;
    actionGuideVersion?: string;
    actionGuideAiGenerated?: boolean;
    reflection: string;
    generator: string;
    aiGenerated: boolean;
  } | null;
  order: {
    id: string;
    status: string;
    provider: string;
    amount: number;
    tax: number;
  } | null;
  followups: {
    id: string;
    question: string;
    answer: string | null;
    status: string;
  }[];
}
export interface Catalog {
  price: number;
  followups: number;
  hexagrams: Hexagram[];
  method: {
    name: string;
    explanation: string;
    interpretation: string;
    sources: { title: string; url: string }[];
  };
  contentStatus: string;
}
