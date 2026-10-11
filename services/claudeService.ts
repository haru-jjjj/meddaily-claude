import { StudyContent, Source, SubCategory, CategoryType, Language, StudyLength, RecallQuestion, Series, SeriesPart } from "../types";
import { CATEGORY_MAP } from "../constants";
import { newId } from "./id";

// --- API KEY ---
// TEMPORARY: read directly from the client bundle for local dev only.
// TODO before deploying publicly: move this call behind a Vercel serverless
// function so the key is never shipped to the browser.
const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;

if (!apiKey) {
  console.error('Anthropic API key is missing. Set VITE_ANTHROPIC_API_KEY in your environment variables.');
}

const MODEL_NAME = 'claude-sonnet-5';
const API_URL = 'https://api.anthropic.com/v1/messages';

// --- STABILITY CONFIGURATION ---
const TIMEOUT_MS = 120000;
const MAX_RETRIES = 1;
// max_tokens is a hard cap on thinking + answer combined. Sonnet 5 thinks by
// default, so a small cap can cut the answer off before the card is written
// (which used to trigger slow retries). Unused tokens are not billed.
const MAX_TOKENS = 16000;

export type DraftHandler = (draft: { title: string; body: string }) => void;

// --- STUDY CONTEXT (fed by the app from synced history) ---
// coverage: cards read per specialty in the last 2 weeks -> random mode
// favours specialties you've seen less. knownTopics: topics already read on
// any device -> avoided when picking a new topic.
let coverageCounts: Record<string, number> = {};
let knownTopics: string[] = [];
export const setStudyContext = (ctx: { coverage?: Record<string, number>; topics?: string[] }) => {
  if (ctx.coverage) coverageCounts = ctx.coverage;
  if (ctx.topics) knownTopics = ctx.topics;
};

// --- HISTORY TRACKING UTILS ---
const HISTORY_KEY = 'medDaily_topicHistory';
const HISTORY_LIMIT = 50;

const getHistory = (): string[] => {
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    const local: string[] = stored ? JSON.parse(stored) : [];
    // merge with topics from synced history, newest first, no duplicates
    return Array.from(new Set([...local, ...knownTopics])).slice(0, 80);
  } catch (e) {
    return [];
  }
};

const addToHistory = (topic: string) => {
  try {
    if (!topic || topic.length < 3) return;
    const history = getHistory();
    const newHistory = [topic, ...history.filter(t => t !== topic)].slice(0, HISTORY_LIMIT);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
  } catch (e) {
    console.error("Failed to save history", e);
  }
};

const pickRandom = (list: SubCategory[]): SubCategory => {
  const cleanList = list.filter(c =>
    c !== SubCategory.OTHER_GENERAL &&
    c !== SubCategory.RANDOM &&
    c !== SubCategory.INTERNAL_MEDICINE_GENERAL
  );
  // Weighted random: a specialty read n times in the last 2 weeks gets weight 1/(1+n)
  const weights = cleanList.map(c => 1 / (1 + (coverageCounts[c] || 0)));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < cleanList.length; i++) {
    r -= weights[i];
    if (r <= 0) return cleanList[i];
  }
  return cleanList[cleanList.length - 1];
};

const SPECIALTY_VALUES: string[] = Object.values(SubCategory).filter(v =>
  v !== SubCategory.OTHER_GENERAL && v !== SubCategory.RANDOM && v !== SubCategory.INTERNAL_MEDICINE_GENERAL
);

// --- AUDIENCE LEVEL ---
// Internal medicine subspecialties (and clinical pharmacology) are written at
// specialist depth; other fields at senior-resident depth.
const SPECIALIST_CATEGORIES = new Set<SubCategory>([
  ...CATEGORY_MAP[CategoryType.INTERNAL_MEDICINE],
  ...CATEGORY_MAP[CategoryType.PHARMACOLOGY]
]);

const getAudience = (category: SubCategory | null): string => {
  if (category === null) {
    return "Reader: a physician with internal-medicine specialist training. Use subspecialty-level depth if the topic belongs to internal medicine; otherwise write at senior-resident level (core knowledge, red flags, first-line management, when to refer).";
  }
  if (SPECIALIST_CATEGORIES.has(category)) {
    return "Reader: a board-certified internist / subspecialty fellow. Skip what they already know. Aim at subspecialty-board depth: guideline nuance, thresholds, drug choice rationale, evidence behind each recommendation.";
  }
  return "Reader: an internal-medicine physician who is not a specialist in this field. Write at senior-resident level: core knowledge, recognition, red flags, first-line management, and when to refer.";
};

const QUALITY_RULES = `
Quality rules:
- Be concrete. Give exact numbers where they matter: drug doses with units and frequency (and renal adjustment if relevant), diagnostic cut-offs, scoring systems, test performance, effect sizes (HR/RR/NNT). Only give numbers you are confident are correct; omit a number rather than guess.
- Name evidence precisely: society + year for guidelines (e.g. "2023 ESC"), acronym + year + journal for trials, and class/level of recommendation when it matters.
- When practice has changed, say what changed and why.
- Keep established recommendations separate from expert opinion or ongoing controversy.
- Complete every section of the structure; never trail off. Finish markdownBody with a short final section of 2-3 bullets titled in the card's language (e.g. "핵심 정리", "Bottom line", "まとめ").
- Format with markdown: ## headings, short paragraphs, bullet lists, and a table when comparing options or criteria.
- Write markdownBody as plain markdown only. Never include <cite> tags or any inline citation markup; sources go only in the sources field.
- Sources: 2-4 items, each with a real URL (guideline page, PubMed, DOI, society site). Never invent a URL; if you are not certain of the exact URL, leave uri as an empty string and give the precise reference in title.`;

const getLengthInstruction = (length: StudyLength): string => {
  switch (length) {
    case StudyLength.SHORT:
      return "Very concise: about 150-200 words. Only the highest-yield facts and numbers.";
    case StudyLength.DETAILED:
      return "Comprehensive deep dive: about 800-1000 words. Include mechanism, evidence (with trial names and numbers), diagnosis, detailed management, and pitfalls.";
    case StudyLength.MEDIUM:
    default:
      return "Balanced: about 400-500 words. Core facts plus the advanced points a specialist would add.";
  }
};

const getLanguageStyleGuide = (language: Language): string => {
  if (language === Language.KOREAN) {
    return `
      **KOREAN LANGUAGE RULES**:
      - Write as a Korean university hospital professor, in professional medical Korean.
      - Do not translate standard medical terms into obscure Korean. Use "한국어(English)" or keep the English term.
      - Example: "심부전(Heart Failure)", "First-line therapy".
    `;
  }
  if (language === Language.JAPANESE) {
    return `
      **JAPANESE LANGUAGE RULES**:
      - Write as a Japanese medical professor, in professional medical Japanese (da/dearu style).
      - Use standard kanji/katakana terms; add English in parentheses for key terms.
    `;
  }
  return `**WRITE IN ${language}.**`;
};

// --- ERRORS & RETRY ---
class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Only retry problems that a second attempt can fix (rate limit, overload,
// server error, network drop, timeout) — not bad requests or a bad key.
const isRetryable = (error: any): boolean => {
  if (error instanceof ApiError) {
    return error.status === 429 || error.status >= 500;
  }
  return true;
};

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Request timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

async function withRetry<T>(operation: () => Promise<T>, retries = MAX_RETRIES, delay = 1500): Promise<T> {
  try {
    return await withTimeout(operation(), TIMEOUT_MS);
  } catch (error: any) {
    if (retries > 0 && isRetryable(error)) {
      console.warn(`Retry (${retries} left) due to: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(operation, retries - 1, delay * 2);
    }
    throw error;
  }
}

// --- Tool schema the model fills in for a study card ---
// Field order matters for streaming: title and markdownBody come first so the
// article can appear on screen while the rest is still being written.
const STUDY_CARD_TOOL = {
  name: "submit_study_card",
  description: "Submit the completed medical study card.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Title in the requested language" },
      markdownBody: { type: "string", description: "The full study content, in Markdown" },
      topic: { type: "string", description: "Specific topic name in English (used for history/dedup)" },
      specialty: { type: "string", enum: SPECIALTY_VALUES, description: "The single specialty this card belongs to" },
      keyPoints: {
        type: "array",
        items: { type: "string" },
        description: "2-3 one-line takeaways in the card's language (the facts to remember)"
      },
      recall: {
        type: "object",
        description: "One O/X recall question for spaced review, in the card's language.",
        properties: {
          fact: { type: "string", description: "The correct key fact from this card that the question tests" },
          statement: { type: "string", description: "Self-contained true/false statement (name the disease/drug/test; never 'this study'). About half the time make it false by changing ONE key detail plausibly (a number, criterion, first-line drug, direction of effect)." },
          explanation: { type: "string", description: "1-2 sentences stating the correct fact and why" },
          isTrue: { type: "boolean", description: "Whether the statement is true. Decide this last, after checking it against fact." }
        },
        required: ["fact", "statement", "explanation", "isTrue"]
      },
      sources: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Precise reference: guideline/society/year or authors, journal, year" },
            uri: { type: "string", description: "Real URL, or empty string if not certain" }
          },
          required: ["title", "uri"]
        },
        description: "2-4 specific sources backing the content"
      },
      suggestedTopics: {
        type: "array",
        items: { type: "string" },
        description: "3 related topics for further study"
      },
      imageQueries: {
        type: "array",
        items: { type: "string" },
        description: "2-3 short ENGLISH search phrases for real medical images that would help understanding (e.g. 'erythema migrans skin lesion', 'aortic dissection CT', 'Brugada ECG'). Name the finding plus the modality or 'photo'/'diagram'. Use different angles (e.g. typical appearance, imaging, histology). Empty array if images would not help."
      },
      flowchart: {
        type: "string",
        description: "OPTIONAL Mermaid flowchart source (starting with 'flowchart TD') ONLY when the topic has a real decision algorithm or stepwise pathway; otherwise an empty string. Max 12 nodes. Every node label must be in double quotes, e.g. A[\"Suspected PE\"] --> B{\"Wells > 4?\"}. Labels in the card's language. No styling, no subgraphs."
      }
    },
    required: ["title", "markdownBody", "topic", "specialty", "keyPoints", "recall", "sources", "suggestedTopics", "imageQueries"]
  }
};

interface CallOptions {
  searchMaxUses?: number;            // >0 makes web_search available
  forceTool: boolean;                // true = fastest path (no thinking)
  effort?: 'low' | 'medium' | 'high';
  onDraft?: DraftHandler;            // set = stream and report partial text
}

// Reads a (possibly unfinished) JSON string value out of partial tool JSON.
function extractPartialString(json: string, key: string): string {
  const m = new RegExp(`"${key}"\\s*:\\s*"`).exec(json);
  if (!m) return "";
  let i = m.index + m[0].length;
  let raw = "";
  while (i < json.length) {
    const c = json[i];
    if (c === "\\") {
      if (i + 1 >= json.length) break;
      if (json[i + 1] === "u") {
        if (i + 6 > json.length) break;
        raw += json.slice(i, i + 6);
        i += 6;
        continue;
      }
      raw += c + json[i + 1];
      i += 2;
      continue;
    }
    if (c === '"') break;
    raw += c;
    i++;
  }
  try {
    return JSON.parse('"' + raw + '"');
  } catch (e) {
    return raw.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
}

function pickCardFromContent(content: any[]): any {
  const toolUse = (content || []).find((b: any) => b.type === "tool_use" && b.name === "submit_study_card");
  if (toolUse) return toolUse.input;
  // Fallback: if the model answered in plain text instead of the tool, keep it.
  const text = (content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
  if (text.length > 200) {
    return { title: "", markdownBody: text, topic: "General", sources: [], suggestedTopics: [], imageQueries: [] };
  }
  throw new Error("Model did not return a study card");
}

async function readStream(res: Response, onDraft: DraftHandler): Promise<any> {
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const blocks: Record<number, { type: string; name?: string; json: string; text: string }> = {};
  let cardIndex = -1;
  let stopReason = "";
  let lastEmit = 0;

  const emit = (force = false) => {
    if (cardIndex < 0) return;
    const now = Date.now();
    if (!force && now - lastEmit < 150) return;
    lastEmit = now;
    const json = blocks[cardIndex].json;
    onDraft({ title: extractPartialString(json, "title"), body: extractPartialString(json, "markdownBody") });
  };

  const handleEvent = (data: any) => {
    switch (data.type) {
      case "content_block_start": {
        const b = data.content_block || {};
        blocks[data.index] = { type: b.type, name: b.name, json: "", text: "" };
        if (b.type === "tool_use" && b.name === "submit_study_card") cardIndex = data.index;
        break;
      }
      case "content_block_delta": {
        const blk = blocks[data.index];
        if (!blk) break;
        if (data.delta?.type === "input_json_delta") {
          blk.json += data.delta.partial_json || "";
          if (data.index === cardIndex) emit();
        } else if (data.delta?.type === "text_delta") {
          blk.text += data.delta.text || "";
        }
        break;
      }
      case "message_delta":
        if (data.delta?.stop_reason) stopReason = data.delta.stop_reason;
        break;
      case "error":
        throw new ApiError(`Stream error: ${data.error?.message || "unknown"}`,
          data.error?.type === "overloaded_error" ? 529 : 500);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const dataLine = chunk.split("\n").find(l => l.startsWith("data:"));
      if (!dataLine) continue;
      const payload = dataLine.slice(5).trim();
      if (!payload) continue;
      handleEvent(JSON.parse(payload));
    }
  }

  if (cardIndex >= 0) {
    emit(true);
    try {
      return JSON.parse(blocks[cardIndex].json || "{}");
    } catch (e) {
      throw new Error(stopReason === "max_tokens" ? "Answer was cut off (max_tokens)" : "Could not read the study card");
    }
  }
  const content = Object.values(blocks).map(b => ({ type: b.type, text: b.text }));
  return pickCardFromContent(content);
}

/**
 * Calls the Claude API and returns the parsed input of the submit_study_card tool call.
 */
async function callClaudeForStudyCard(system: string, prompt: string, opts: CallOptions): Promise<any> {
  const tools: any[] = [STUDY_CARD_TOOL];
  if (opts.searchMaxUses && opts.searchMaxUses > 0) {
    tools.unshift({ type: "web_search_20250305", name: "web_search", max_uses: opts.searchMaxUses });
  }

  const body: any = {
    model: MODEL_NAME,
    max_tokens: MAX_TOKENS,
    system: system + `\n\nWhen you are ready, call submit_study_card exactly once with the complete content. Do not answer in plain text.`,
    messages: [{ role: "user", content: prompt }],
    tools,
    tool_choice: opts.forceTool ? { type: "tool", name: "submit_study_card" } : { type: "auto" }
  };
  // A forced tool call starts immediately without thinking, so effort only
  // matters on the auto path.
  if (!opts.forceTool && opts.effort) body.output_config = { effort: opts.effort };
  if (opts.onDraft) body.stream = true;

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey || "",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new ApiError(`Claude API error ${res.status}: ${errText}`, res.status);
  }

  if (opts.onDraft) return readStream(res, opts.onDraft);

  const data = await res.json();
  if (data.stop_reason === "max_tokens" && !(data.content || []).some((b: any) => b.type === "tool_use")) {
    throw new Error("Answer was cut off (max_tokens)");
  }
  return pickCardFromContent(data.content);
}

function stripCitationMarkup(text: string): string {
  if (!text) return text;
  return text.replace(/<cite[^>]*>/gi, "").replace(/<\/cite>/gi, "");
}

function toRecall(r: any): RecallQuestion | undefined {
  if (!r || typeof r.statement !== "string" || !r.statement.trim() || typeof r.isTrue !== "boolean") return undefined;
  return { statement: r.statement.trim(), isTrue: r.isTrue, explanation: String(r.explanation || r.fact || "").trim() };
}

function toStudyContent(input: any, language: Language, length?: StudyLength): StudyContent {
  const sources: Source[] = [];
  const seen = new Set<string>();
  if (Array.isArray(input.sources)) {
    input.sources.forEach((s: any) => {
      const title = typeof s?.title === "string" ? s.title.trim() : "";
      if (!title) return;
      let uri = typeof s?.uri === "string" ? s.uri.trim() : "";
      // No reliable URL → link to a PubMed search for the exact reference,
      // so every source stays clickable and checkable.
      if (!/^https?:\/\//i.test(uri)) {
        uri = `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(title)}`;
      }
      if (seen.has(uri)) return;
      seen.add(uri);
      sources.push({ title, uri });
    });
  }
  return {
    id: newId(),
    createdAt: Date.now(),
    language,
    length,
    specialty: SPECIALTY_VALUES.includes(input.specialty) ? input.specialty : undefined,
    keyPoints: Array.isArray(input.keyPoints)
      ? input.keyPoints.filter((k: any) => typeof k === "string" && k.trim()).slice(0, 3)
      : [],
    recall: toRecall(input.recall),
    title: input.title || (language === Language.KOREAN ? "의학 주제" : "Medical Topic"),
    content: stripCitationMarkup(input.markdownBody || "No content generated."),
    topic: input.topic || "General",
    sources,
    suggestedTopics: Array.isArray(input.suggestedTopics) ? input.suggestedTopics : [],
    imageQueries: Array.isArray(input.imageQueries)
      ? input.imageQueries.filter((q: any) => typeof q === "string" && q.trim()).slice(0, 3)
      : [],
    flowchart: typeof input.flowchart === "string" && /^\s*(flowchart|graph)\s/i.test(input.flowchart)
      ? input.flowchart.trim()
      : undefined
  };
}

const VISUALS_RULE = "Give 2-3 imageQueries (English) for real images of the key finding/lesion/test, from different angles. Add a Mermaid flowchart only if there is a genuine algorithm or pathway. Fill keyPoints and the recall O/X question from the most important fact of this card.";

// --- Main topic generator (7-sided diversity dice) ---
export const generateMedicalTopic = async (
  category: SubCategory,
  isRandom: boolean,
  language: Language,
  length: StudyLength,
  forceResearchMode: boolean = false,
  onDraft?: DraftHandler
): Promise<StudyContent> => {

  let targetCategory = category;
  if (isRandom) {
    const all = [...CATEGORY_MAP[CategoryType.INTERNAL_MEDICINE], ...CATEGORY_MAP[CategoryType.OTHER], ...CATEGORY_MAP[CategoryType.PHARMACOLOGY]];
    targetCategory = pickRandom(all);
  } else if (category === SubCategory.OTHER_GENERAL) {
    targetCategory = pickRandom(CATEGORY_MAP[CategoryType.OTHER]);
  } else if (category === SubCategory.INTERNAL_MEDICINE_GENERAL) {
    targetCategory = pickRandom(CATEGORY_MAP[CategoryType.INTERNAL_MEDICINE]);
  }

  let diceRoll = Math.floor(Math.random() * 7) + 1;
  if (forceResearchMode) {
    diceRoll = Math.random() < 0.5 ? 1 : 2;
  }
  // Only the "landmark trial" and "latest update" strategies need a live web
  // search; the rest is stable textbook-level knowledge.
  const needsSearch = diceRoll === 1 || diceRoll === 2;

  let diversityInstruction = "";
  let structureInstruction = "";

  const standardStructure = `
      - Title
      - Clinical Pearl / Key Takeaway
      - Pathophysiology / Mechanism
      - Diagnosis & Management
      - Practical Tips
  `;
  const trialStructure = `
      - Title (Trial Name)
      - Background (The Clinical Question)
      - Methodology (PICO)
      - Results (primary endpoint with effect size and CI; key secondary/safety outcomes)
      - Clinical Takeaway & Impact (which guideline recommendation it changed)
      - Critique / Limitations
  `;
  const debateStructure = `
      - Title
      - The Controversy (Why is this debated?)
      - Argument A (Viewpoint 1, with its evidence)
      - Argument B (Viewpoint 2, with its evidence)
      - Current Consensus / Recommendation
  `;
  const practicalStructure = `
      - Title
      - Clinical Scenario (When to do this)
      - Practical Action Steps / Protocol
      - Drug Doses & Selection Guide
      - Common Mistakes
  `;

  switch (diceRoll) {
    case 1:
      diversityInstruction = `
            - **STRATEGY: LANDMARK TRIALS**
            - **TASK**: Select a historical game-changer clinical trial that shaped current guidelines in **${targetCategory}**.
            - **Examples**: ISCHEMIA, SPRINT, COURAGE, AFFIRM, RALES, PLATO, etc.
            - **Focus**: Why was it done? What exactly did it show (numbers)? How did it change practice?
          `;
      structureInstruction = trialStructure;
      break;
    case 2:
      diversityInstruction = `
            - **STRATEGY: LATEST UPDATE**
            - **TASK**: Select a high-impact study or guideline update from the last 1-2 years in **${targetCategory}**.
            - **Focus**: What is new, how it differs from previous practice, and what remains debated.
          `;
      structureInstruction = trialStructure;
      break;
    case 3:
      diversityInstruction = `
            - **STRATEGY: NICHE & DETAIL**
            - **TASK**: Select a specific, often forgotten mechanism, anatomical detail, or rare syndrome in **${targetCategory}**.
            - **Focus**: The "why", at the level of textbook footnotes. Avoid generic topics.
          `;
      structureInstruction = standardStructure;
      break;
    case 4:
      diversityInstruction = `
            - **STRATEGY: DEBATE & CONTROVERSY**
            - **TASK**: Select a topic in **${targetCategory}** where expert consensus is lacking or guidelines disagree.
            - **Focus**: Opposing views with their evidence, gray-zone decision making, evidence gaps.
          `;
      structureInstruction = debateStructure;
      break;
    case 5:
      diversityInstruction = `
            - **STRATEGY: CLINICAL PITFALL**
            - **TASK**: Select a common mistake, missed diagnosis, or trap in **${targetCategory}**.
            - **Focus**: "Don't miss this", "commonly misdiagnosed as...", medication errors.
          `;
      structureInstruction = standardStructure;
      break;
    case 6:
      diversityInstruction = `
            - **STRATEGY: ESSENTIAL BASICS**
            - **TASK**: Select a fundamental, must-know topic in **${targetCategory}**.
            - **Focus**: Standard of care, with the high-yield pearls experts value.
          `;
      structureInstruction = standardStructure;
      break;
    case 7:
      diversityInstruction = `
            - **STRATEGY: PRACTICAL TIPS**
            - **TASK**: Select a hands-on topic in **${targetCategory}**.
            - **Focus**: Exact drug dosing, drug selection rationale, procedural steps, what exactly to order.
          `;
      structureInstruction = practicalStructure;
      break;
  }

  const history = getHistory();
  const historyExclusion = history.length > 0
    ? `**BLOCKLIST**: DO NOT write about: ${history.join(', ')}. Pick something DIFFERENT.`
    : "";

  const randomSalt = Math.random().toString(36).substring(7);
  const system = `You are a senior medical educator writing a single study card.\n${getAudience(targetCategory)}\n${QUALITY_RULES}`;

  const prompt = `
    Subject: **${targetCategory}**
    ${diversityInstruction}
    ${historyExclusion}
    [Random Seed: ${randomSalt}]

    Language:
    ${getLanguageStyleGuide(language)}

    Length: ${getLengthInstruction(length)}

    Structure:
    ${structureInstruction}

    Requirements:
    1. ${needsSearch ? "Use web_search (a few targeted searches) to verify the key facts and numbers before writing." : "Rely on well-established medical knowledge."}
    2. Suggest 3 related topics.
    3. ${VISUALS_RULE}
  `;

  // Speed plan: searching strategies think a little (medium); textbook topics
  // go straight to writing, except Deep Dive which is allowed to think.
  const opts: CallOptions = needsSearch
    ? { searchMaxUses: 4, forceTool: false, effort: 'medium', onDraft }
    : length === StudyLength.DETAILED
      ? { forceTool: false, effort: 'medium', onDraft }
      : { forceTool: true, onDraft };

  return withRetry(async () => {
    const toolInput = await callClaudeForStudyCard(system, prompt, opts);
    const parsed = toStudyContent(toolInput, language, length);
    parsed.specialty = targetCategory;
    if (parsed.topic && parsed.topic !== "General") addToHistory(parsed.topic);
    return parsed;
  });
};

export const generateTopicFromKeyword = async (
  keyword: string,
  language: Language,
  length: StudyLength,
  onDraft?: DraftHandler
): Promise<StudyContent> => {
  const system = `You are a senior medical educator writing a single study card.\n${getAudience(null)}\n${QUALITY_RULES}`;
  const prompt = `
    Topic: **"${keyword}"**
    Context: Clinical practice and current standards.

    Language:
    ${getLanguageStyleGuide(language)}

    Length: ${getLengthInstruction(length)}

    Structure:
    - Title
    - Key Takeaway
    - Pathophysiology / Mechanism
    - Diagnosis & Management
    - Practical Tips

    Requirements:
    1. Use web_search only if the topic is a recent trial or guideline, or you are unsure of a key number. Otherwise write directly.
    2. Suggest 3 related topics.
    3. ${VISUALS_RULE}
  `;

  return withRetry(async () => {
    const toolInput = await callClaudeForStudyCard(system, prompt, { searchMaxUses: 2, forceTool: false, effort: 'low', onDraft });
    const parsed = toStudyContent(toolInput, language, length);
    if (parsed.topic && parsed.topic !== "General") addToHistory(parsed.topic);
    return parsed;
  });
};

export const rewriteContent = async (
  currentTopic: string,
  length: StudyLength,
  language: Language,
  onDraft?: DraftHandler
): Promise<StudyContent> => {
  const system = `You are a senior medical educator rewriting a study card.\n${getAudience(null)}\n${QUALITY_RULES}`;
  const prompt = `
    Task: Rewrite the study card for topic: **"${currentTopic}"**.

    New length: ${getLengthInstruction(length)}
    Language: ${getLanguageStyleGuide(language)}

    Instructions:
    1. Keep the medical accuracy and the core topic; adjust depth to the new length.
    2. Keep "topic" exactly as: "${currentTopic}"
    3. ${VISUALS_RULE}
  `;

  return withRetry(async () => {
    const toolInput = await callClaudeForStudyCard(system, prompt, { forceTool: true, onDraft });
    return toStudyContent(toolInput, language, length);
  });
};

// ===================== SERIES (connected multi-part study) =====================

const SERIES_PLAN_TOOL = {
  name: "submit_series_plan",
  description: "Submit the outline of a study series.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Series title in the requested language" },
      specialty: { type: "string", enum: SPECIALTY_VALUES, description: "Main specialty of the series" },
      parts: {
        type: "array",
        description: "Ordered parts. Each builds on the previous ones.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Part title in the requested language" },
            focus: { type: "string", description: "One sentence: what this part covers and how it builds on earlier parts" }
          },
          required: ["title", "focus"]
        }
      }
    },
    required: ["title", "specialty", "parts"]
  }
};

async function callForcedTool(system: string, prompt: string, tool: any): Promise<any> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey || "",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      max_tokens: 4000,
      system,
      messages: [{ role: "user", content: prompt }],
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name }
    })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new ApiError(`Claude API error ${res.status}: ${errText}`, res.status);
  }
  const data = await res.json();
  const toolUse = (data.content || []).find((b: any) => b.type === "tool_use" && b.name === tool.name);
  if (!toolUse) throw new Error("Model did not return a plan");
  return toolUse.input;
}

/**
 * Plans a series: a short curriculum of `partCount` connected cards on a theme,
 * ordered from foundations to applied/advanced points.
 */
export const planSeries = async (
  theme: string,
  partCount: number,
  language: Language,
  length: StudyLength
): Promise<Series> => {
  const system = `You are a senior medical educator designing a short, connected study series.\n${getAudience(null)}`;
  const prompt = `
    Theme: "${theme}"
    Number of parts: ${partCount}

    Design an ordered series where each part builds on the previous ones, e.g.
    core concept/physiology → diagnosis → classification or differential → treatment → special situations → pitfalls and recent evidence.
    Adapt this order to the theme. No overlap between parts; together they should cover the theme the way a specialist would want.

    Language for title and part titles/focus:
    ${getLanguageStyleGuide(language)}
  `;
  const input = await withRetry(() => callForcedTool(system, prompt, SERIES_PLAN_TOOL));
  const parts: SeriesPart[] = (Array.isArray(input.parts) ? input.parts : [])
    .filter((p: any) => p && typeof p.title === "string" && p.title.trim())
    .slice(0, 10)
    .map((p: any) => ({ title: p.title.trim(), focus: String(p.focus || "").trim() }));
  if (parts.length < 2) throw new Error("Series plan was empty");
  const now = Date.now();
  return {
    id: newId(),
    title: String(input.title || theme).trim(),
    theme,
    specialty: SPECIALTY_VALUES.includes(input.specialty) ? input.specialty : undefined,
    language,
    length,
    parts,
    createdAt: now,
    updatedAt: now
  };
};

/**
 * Writes part `index` of a series, using the outline and the key points of the
 * parts already read so it continues from them instead of repeating them.
 */
export const generateSeriesPart = async (
  series: Series,
  index: number,
  previousCards: StudyContent[],
  onDraft?: DraftHandler
): Promise<StudyContent> => {
  const part = series.parts[index];
  const outline = series.parts
    .map((p, i) => `${i + 1}. ${p.title} — ${p.focus}${i === index ? "   <== WRITE THIS PART" : ""}`)
    .join("\n");
  const covered = previousCards
    .filter(c => typeof c.seriesIndex === "number" && c.seriesIndex < index)
    .sort((a, b) => (a.seriesIndex as number) - (b.seriesIndex as number))
    .map(c => `Part ${(c.seriesIndex as number) + 1} (${c.title}):\n${(c.keyPoints || []).map(k => `- ${k}`).join("\n")}`)
    .join("\n\n");

  const category = (series.specialty && SPECIALTY_VALUES.includes(series.specialty))
    ? series.specialty as SubCategory : null;
  const system = `You are a senior medical educator writing one part of a connected study series.\n${getAudience(category)}\n${QUALITY_RULES}`;
  const prompt = `
    Series: "${series.title}" (${series.parts.length} parts)
    Outline:
    ${outline}

    ${covered ? `Already covered in earlier parts (do not repeat; build on it, referring back briefly where useful):\n${covered}` : "This is the first part: lay the foundation the later parts will build on."}

    Now write part ${index + 1}: "${part.title}" — ${part.focus}
    Use the part title as the card title. End with one line previewing what the next part covers${index === series.parts.length - 1 ? " (this is the last part: instead, end with a short wrap-up of the whole series)" : ""}.

    Language:
    ${getLanguageStyleGuide(series.language)}

    Length: ${getLengthInstruction(series.length)}

    Requirements:
    1. Rely on well-established medical knowledge.
    2. Suggest 3 related topics.
    3. ${VISUALS_RULE}
  `;

  const opts: CallOptions = series.length === StudyLength.DETAILED
    ? { forceTool: false, effort: 'medium', onDraft }
    : { forceTool: true, onDraft };

  return withRetry(async () => {
    const toolInput = await callClaudeForStudyCard(system, prompt, opts);
    const parsed = toStudyContent(toolInput, series.language, series.length);
    parsed.seriesId = series.id;
    parsed.seriesIndex = index;
    parsed.seriesTitle = series.title;
    if (category) parsed.specialty = category;
    if (parsed.topic && parsed.topic !== "General") addToHistory(parsed.topic);
    return parsed;
  });
};
