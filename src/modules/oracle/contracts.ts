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
  expiresAt: string | null;
  saved: boolean;
  favorite: boolean;
  note: string;
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
