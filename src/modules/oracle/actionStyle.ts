import type { Lang } from "../../lib/i18n.js";
import { z } from "zod";

export const ACTION_GUIDE_VERSION = "crystal-1";
export const ActionText = z
  .string()
  .trim()
  .min(40)
  .max(1200)
  .refine(
    (value) =>
      /^1[.)]\s[\s\S]*\n\s*2[.)]\s[\s\S]*\n\s*3[.)]\s[\s\S]*\n\s*4[.)]\s/.test(
        value,
      ),
    "Use four ordered, numbered paragraphs for the action guide.",
  );

/** Product adaptation of philosophical clarification, not quotations or claims of authorship. */
export const ACTION_STYLE = `Write practical guidance with crystalline clarity inspired by Wittgenstein's attention to facts, the use of words in a concrete situation, and the limits of what can be stated. Do not name-drop the philosopher, fabricate quotations, use philosophical jargon or imitate numbered mystical pronouncements.
Distinguish what the user actually reported from an interpretation or an unknown. Turn one vague word (such as success, commitment or security) into a proposed observable criterion that the user can accept or change; never present that criterion as already agreed. Connect the symbolic hexagram to ONE small, reversible experiment in the user's own control, not a prediction or a requirement to obey an oracle.
Make the experiment executable: a reasonable time cue, one concrete verb and object, and a short time budget. If timing is unspecified, propose today and 10 minutes as a suggestion, never as a fact about the user's schedule. Give one exact sentence the user could say, send, write or ask themselves, clearly as a suggested script rather than a statement someone has already made.
Finish with a visible completion check: what to write down or observe, what counts as not yet known, and a modest next step if no answer is obtained. Completing the user's step is distinct from obtaining another person's agreement. Never infer a person's feelings from silence, guarantee outcomes, prescribe investments or contract/payment terms, or recommend unsafe contact. Keep all suggestions proportionate and optional. Replace abstractions like trust the process, raise your vibration, be positive or communicate better with a concrete act.`;

export const ACTION_FIELD_RULES = `The action field must contain four short numbered paragraphs, each with a short heading in the requested language: 1. Clarify (one reported fact or unknown and an operational definition); 2. Try (one small action with a time cue and time budget); 3. Say or write (one usable suggested sentence); 4. Check (one observable completion criterion and a fallback if uncertain). Keep the whole action within 1200 characters. Do not pad it with an introduction or conclusion.`;

export function sampleAction(topic: "wealth" | "love", language: Lang) {
  const love = topic === "love";
  if (language === "zh-Hans")
    return love
      ? "1. 澄清\n先把‘关系更好’写成一个你希望看到的具体变化；这只是你的期待，还不是双方的约定。\n\n2. 尝试\n如果今天方便，用 10 分钟写出一个你希望表达的需要，以及一项自己愿意做的小改变。\n\n3. 表达\n可以写：‘我想和你商量一个小改变。你愿意找个方便的时间听听吗？’先写成草稿，自行决定是否联系。\n\n4. 检查\n以写出草稿为完成标准；如果选择沟通，记录对方实际说了什么。没有回复就标为‘尚未确认’，不推断感情。"
      : "1. 澄清\n把‘有进展’写成一个可观察的变化，例如一个关键问题得到明确答复；先区分已确认的信息与自己的设想。\n\n2. 尝试\n如果今天方便，用 10 分钟写下当前最需要核实的一个问题，并找出可以核实它的信息来源。\n\n3. 表达\n可以写：‘在继续之前，我想确认这项安排。哪些已经确定，哪些还需要讨论？’根据实际情况修改这句话。\n\n4. 检查\n记录问题、来源与答复；没有答复就标为‘尚未确认’。完成记录就是这一步的完成，不等于对方已经同意。";
  if (language === "zh-Hant")
    return love
      ? "1. 澄清\n先把「關係更好」寫成一個你希望看到的具體變化；這只是你的期待，還不是雙方的約定。\n\n2. 嘗試\n如果今天方便，用 10 分鐘寫出一個你希望表達的需要，以及一項自己願意做的小改變。\n\n3. 表達\n可以寫：「我想和你商量一個小改變。你願意找個方便的時間聽聽嗎？」先寫成草稿，自行決定是否聯絡。\n\n4. 檢查\n以寫出草稿為完成標準；如果選擇溝通，記錄對方實際說了什麼。沒有回覆就標為「尚未確認」，不推斷感情。"
      : "1. 澄清\n把「有進展」寫成一個可觀察的變化，例如一個關鍵問題得到明確答覆；先區分已確認的資訊與自己的設想。\n\n2. 嘗試\n如果今天方便，用 10 分鐘寫下當前最需要核實的一個問題，並找出可以核實它的資訊來源。\n\n3. 表達\n可以寫：「在繼續之前，我想確認這項安排。哪些已經確定，哪些還需要討論？」根據實際情況修改這句話。\n\n4. 檢查\n記錄問題、來源與答覆；沒有答覆就標為「尚未確認」。完成記錄就是這一步的完成，不等於對方已經同意。";
  return love
    ? "1. Clarify\nDefine one change you mean by “closer.” Treat it as your wish, not an agreement.\n\n2. Try\nIf today suits you, take 10 minutes to draft one need and one change you can make.\n\n3. Say or write\nTry: “I would like to discuss one small change. Is there a good time to hear each other?” Decide for yourself whether contact is appropriate.\n\n4. Check\nA written draft completes this step. If you talk, record the actual reply. Silence means “not yet confirmed,” not evidence of how someone feels."
    : "1. Clarify\nDefine “progress” as one observable change, such as getting an answer to a key question. Separate confirmed facts from a proposal.\n\n2. Try\nIf today suits you, take 10 minutes to write one question and identify a source that can answer it.\n\n3. Say or write\nTry: “Before I continue, what is confirmed about this arrangement, and what still needs discussion?” Adapt the words to your situation.\n\n4. Check\nRecord the question, source and actual answer. Mark unanswered points “not yet confirmed.” Making this record completes your step; it does not establish agreement.";
}
