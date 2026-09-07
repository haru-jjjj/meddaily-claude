import { StudyContent, Source, SubCategory, CategoryType, Language, StudyLength } from "../types";
import { CATEGORY_MAP } from "../constants";

// --- API KEY ---
// TEMPORARY: read directly from the client bundle for local dev only.
// TODO before deploying: move this call behind a Vercel serverless function
// so the key is never shipped to the browser. Do not deploy with this as-is.
const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;

if (!apiKey) {
  console.error('Anthropic API key is missing. Set VITE_ANTHROPIC_API_KEY in your environment variables.');
}

const MODEL_NAME = 'claude-sonnet-5';
const API_URL = 'https://api.anthropic.com/v1/messages';

// --- STABILITY CONFIGURATION ---
const TIMEOUT_MS = 100000;
const MAX_RETRIES = 2;

// --- HISTORY TRACKING UTILS (unchanged from original) ---
const HISTORY_KEY = 'medDaily_topicHistory';
const HISTORY_LIMIT = 50;

const getHistory = (): string[] => {
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    return stored ? JSON.parse(stored) : [];
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

/**
 * Helper to pick a random subcategory (excludes meta options)
 */
const pickRandom = (list: SubCategory[]): SubCategory => {
  const cleanList = list.filter(c =>
    c !== SubCategory.OTHER_GENERAL &&
    c !== SubCategory.RANDOM &&
    c !== SubCategory.INTERNAL_MEDICINE_GENERAL
  );
  return cleanList[Math.floor(Math.random() * cleanList.length)];
};

const getLengthInstruction = (length: StudyLength): string => {
  switch (length) {
    case StudyLength.SHORT:
      return "Write a very concise summary. Approx 150 words. Focus on key facts only.";
    case StudyLength.DETAILED:
      return "Write a comprehensive deep dive. Approx 800 words. Include pathophysiology, evidence, and detailed management.";
    case StudyLength.MEDIUM:
    default:
      return "Write a balanced summary. Approx 400 words. Cover basics and advanced points.";
  }
};

const getLanguageStyleGuide = (language: Language): string => {
  if (language === Language.KOREAN) {
    return `
      **KOREAN LANGUAGE RULES**:
      - Act as a Korean University Hospital Professor.
      - Use professional medical Korean.
      - **DO NOT** translate standard medical terms into obscure Korean. Use "Korean (English)" or just "English".
      - Example: "심부전(Heart Failure)", "First-line therapy".
    `;
  }
  if (language === Language.JAPANESE) {
    return `
      **JAPANESE LANGUAGE RULES**:
      - Act as a Japanese Medical Professor.
      - Use professional medical Japanese (Da/Aru style).
      - Use standard Kanji/Katakana terms.
    `;
  }
  return `**WRITE IN ${language}.**`;
};

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Request timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([
    promise.then(res => { clearTimeout(timer); return res; }),
    timeoutPromise
  ]);
}

async function withRetry<T>(operation: () => Promise<T>, retries = MAX_RETRIES, delay = 1000): Promise<T> {
  try {
    return await withTimeout(operation(), TIMEOUT_MS);
  } catch (error: any) {
    if (retries > 0) {
      console.warn(`Retry (${retries} left) due to: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(operation, retries - 1, delay * 2);
    }
    throw error;
  }
}

// --- Tool schema the model must fill in for a study card ---
const STUDY_CARD_TOOL = {
  name: "submit_study_card",
  description: "Submit the completed medical study card.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Title in the requested language" },
      topic: { type: "string", description: "Specific topic name (used for history/dedup)" },
      markdownBody: { type: "string", description: "The full study content, in Markdown" },
      sources: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            uri: { type: "string" }
          },
          required: ["title", "uri"]
        },
        description: "2-3 specific sources used to verify the content"
      },
      suggestedTopics: {
        type: "array",
        items: { type: "string" },
        description: "3 related topics for further study"
      }
    },
    required: ["title", "topic", "markdownBody", "sources", "suggestedTopics"]
  }
};

const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search" };

/**
 * Calls the Claude API and returns the parsed input of the submit_study_card tool call.
 */
async function callClaudeForStudyCard(system: string, prompt: string, useSearch: boolean): Promise<any> {
  const tools: any[] = [STUDY_CARD_TOOL];
  if (useSearch) tools.unshift(WEB_SEARCH_TOOL);

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
      max_tokens: 2000,
      system: system + `\n\nWhen you are ready to give your final answer, call submit_study_card exactly once with the complete content. Do not answer in plain text.`,
      messages: [{ role: "user", content: prompt }],
      tools,
      tool_choice: useSearch ? { type: "auto" } : { type: "tool", name: "submit_study_card" }
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Claude API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const toolUse = (data.content || []).find((b: any) => b.type === "tool_use" && b.name === "submit_study_card");
  if (!toolUse) {
    throw new Error("Model did not return a submit_study_card tool call");
  }
  return toolUse.input;
}

/**
 * The model sometimes echoes its own inline citation markup (e.g. <cite index="...">...</cite>)
 * into the markdown body when it has used web_search. Strip the tags but keep the inner text,
 * since attribution belongs only in the separate "sources" field, not inline in the article.
 */
function stripCitationMarkup(text: string): string {
  if (!text) return text;
  return text
    .replace(/<cite[^>]*>/gi, "")
    .replace(/<\/cite>/gi, "");
}

function toStudyContent(input: any, language: Language): StudyContent {
  const sources: Source[] = [];
  const seenUris = new Set<string>();
  if (Array.isArray(input.sources)) {
    input.sources.forEach((s: any) => {
      if (s.uri && s.title && !seenUris.has(s.uri)) {
        sources.push({ title: s.title, uri: s.uri });
        seenUris.add(s.uri);
      }
    });
  }
  return {
    title: input.title || (language === Language.KOREAN ? "의학 주제" : "Medical Topic"),
    content: stripCitationMarkup(input.markdownBody || "No content generated."),
    topic: input.topic || "General",
    sources,
    suggestedTopics: Array.isArray(input.suggestedTopics) ? input.suggestedTopics : []
  };
}

// --- Main topic generator (7-sided diversity dice, unchanged strategy from original) ---
export const generateMedicalTopic = async (
  category: SubCategory,
  isRandom: boolean,
  language: Language,
  length: StudyLength,
  forceResearchMode: boolean = false
): Promise<StudyContent> => {

  return withRetry(async () => {
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
    // Only the "landmark trial" and "latest update" strategies genuinely need a live
    // web search — the others (niche detail, debate, pitfall, essentials, practical
    // tips) are stable textbook-level knowledge Claude already knows well. Skipping
    // the search round-trip for those cuts generation time noticeably.
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
        - Results (Primary Endpoint)
        - Clinical Takeaway & Impact
        - Critique / Limitations
    `;
    const debateStructure = `
        - Title
        - The Controversy (Why is this debated?)
        - Argument A (Viewpoint 1)
        - Argument B (Viewpoint 2)
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
              - **STRATEGY: LANDMARK TRIALS (Dice: 1)**
              - **TASK**: Select a **historical game-changer clinical trial** that shaped current guidelines in **${targetCategory}**.
              - **Examples**: ISCHEMIA, SPRINT, COURAGE, AFFIRM, RALES, PLATO, etc.
              - **Focus**: Why was this study done? What did it show? How did it change practice?
            `;
        structureInstruction = trialStructure;
        break;
      case 2:
        diversityInstruction = `
              - **STRATEGY: LATEST HOT POTATO (Dice: 2)**
              - **TASK**: Select a **highly debated or high-impact recent study/guideline update** from the last 1-2 years in **${targetCategory}**.
              - **Focus**: What is new? What is the controversy? How does it differ from previous practice?
            `;
        structureInstruction = trialStructure;
        break;
      case 3:
        diversityInstruction = `
              - **STRATEGY: NICHE & DETAIL (Dice: 3)**
              - **TASK**: Select a **specific, often forgotten physiological mechanism, anatomical detail, or rare syndrome** in **${targetCategory}**.
              - **Focus**: Deep dive into the "why". Something found in the footnotes of textbooks.
              - **Constraint**: Avoid generic topics. Go deep and specific.
            `;
        structureInstruction = standardStructure;
        break;
      case 4:
        diversityInstruction = `
              - **STRATEGY: DEBATE & CONTROVERSY (Dice: 4)**
              - **TASK**: Select a topic in **${targetCategory}** where **expert consensus is lacking** or treatment guidelines are controversial.
              - **Focus**: Present opposing views, "Gray Zone" decision making, and current evidence gaps.
            `;
        structureInstruction = debateStructure;
        break;
      case 5:
        diversityInstruction = `
              - **STRATEGY: CLINICAL PITFALL (Dice: 5)**
              - **TASK**: Select a **common mistake, missed diagnosis, or trap** that residents/fellows often fall into within **${targetCategory}**.
              - **Focus**: "Don't miss this", "Commonly misdiagnosed as...", "Medication errors".
            `;
        structureInstruction = standardStructure;
        break;
      case 6:
        diversityInstruction = `
              - **STRATEGY: ESSENTIAL BASICS (Dice: 6)**
              - **TASK**: Select a **fundamental, absolute must-know core knowledge** topic in **${targetCategory}**.
              - **Focus**: The "Bread and Butter". Standard of Care.
              - **Constraint**: Provide high-yield pearls that experts value, even for basic topics.
            `;
        structureInstruction = standardStructure;
        break;
      case 7:
        diversityInstruction = `
              - **STRATEGY: PRACTICAL TIPS (Dice: 7)**
              - **TASK**: Select a **highly practical, hands-on topic** in **${targetCategory}**.
              - **Focus**: Real-world skills like specific drug dosing, drug selection rationale, procedural steps, or patient counseling tips.
              - **Constraint**: Focus on "How-to" and "What exactly to order". Avoid vague theory.
            `;
        structureInstruction = practicalStructure;
        break;
    }

    const history = getHistory();
    const historyExclusion = history.length > 0
      ? `**BLOCKLIST**: DO NOT write about: ${history.join(', ')}. Pick something DIFFERENT.`
      : "";

    const randomSalt = Math.random().toString(36).substring(7);

    const promptContext = `
      Subject: **${targetCategory}**
      ${diversityInstruction}
      ${historyExclusion}
      [Random Seed: ${randomSalt}]
    `;

    const lengthInstruction = getLengthInstruction(length);
    const languageStyle = getLanguageStyleGuide(language);

    const system = `Act as a senior medical educator writing a single study card. Write markdownBody as plain prose/markdown only — never include <cite>, citation index tags, or any inline citation markup; attribution belongs only in the separate sources field.`;

    const prompt = `
      ${promptContext}

      Language:
      ${languageStyle}

      Length: ${lengthInstruction}

      Structure:
      ${structureInstruction}

      Requirements:
      1. **ACCURACY**: ${needsSearch ? "Use web_search to verify facts before answering." : "Rely on well-established, textbook-level medical knowledge."}
      2. **SOURCES**: List 2-3 specific sources${needsSearch ? " (URLs)" : " (textbook, guideline name, or 'general clinical knowledge')"}.
      3. **NEXT STEPS**: Suggest 3 related topics.
    `;

    try {
      const toolInput = await callClaudeForStudyCard(system, prompt, needsSearch);
      const parsed = toStudyContent(toolInput, language);
      if (!parsed.topic) throw new Error("Invalid response: missing topic");
      if (parsed.topic && parsed.topic !== "General") addToHistory(parsed.topic);
      return parsed;
    } catch (error) {
      console.error("Error generating topic:", error);
      throw error;
    }
  });
};

export const generateTopicFromKeyword = async (
  keyword: string,
  language: Language,
  length: StudyLength
): Promise<StudyContent> => {
  return withRetry(async () => {
    const lengthInstruction = getLengthInstruction(length);
    const languageStyle = getLanguageStyleGuide(language);
    const randomSalt = Math.random().toString(36).substring(7);

    const system = `Act as a senior medical educator writing a single study card. Write markdownBody as plain prose/markdown only — never include <cite>, citation index tags, or any inline citation markup; attribution belongs only in the separate sources field.`;
    const prompt = `
      Topic: **"${keyword}"**
      Context: Clinical Practice & Standards.

      Language:
      ${languageStyle}

      Length: ${lengthInstruction}

      Structure:
      - Title
      - Key Takeaway
      - Pathophysiology
      - Diagnosis & Management
      - Practical Tips

      Requirements:
      1. Use web_search to verify facts.
      2. Include 2-3 sources.
      3. Include 3 suggested topics.
      [Random Seed: ${randomSalt}]
    `;

    try {
      const toolInput = await callClaudeForStudyCard(system, prompt, true);
      const parsed = toStudyContent(toolInput, language);
      if (!parsed.topic) throw new Error("Invalid response: missing topic");
      return parsed;
    } catch (error) {
      console.error("Error generating keyword topic:", error);
      throw error;
    }
  });
};

export const rewriteContent = async (
  currentTopic: string,
  length: StudyLength,
  language: Language
): Promise<StudyContent> => {
  return withRetry(async () => {
    const lengthInstruction = getLengthInstruction(length);
    const languageStyle = getLanguageStyleGuide(language);

    const system = `Act as a senior medical educator rewriting a study card. Write markdownBody as plain prose/markdown only — never include <cite>, citation index tags, or any inline citation markup; attribution belongs only in the separate sources field.`;
    const prompt = `
        Task: Rewrite content for topic: **"${currentTopic}"**.

        New Length Constraint: ${lengthInstruction}
        Language: ${languageStyle}

        Instructions:
        1. Maintain the medical accuracy and core topic.
        2. Adjust detail level to match the new length.
        3. Rely on well-established, textbook-level medical knowledge (this topic was already verified when first generated).
        4. Keep "topic" exactly as: "${currentTopic}"
      `;

    try {
      const toolInput = await callClaudeForStudyCard(system, prompt, false);
      const parsed = toStudyContent(toolInput, language);
      if (!parsed.topic) throw new Error("Invalid response from rewrite");
      return parsed;
    } catch (error) {
      throw error;
    }
  });
};
