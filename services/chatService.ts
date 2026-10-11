// ============================================================================
// Card Q&A ("질문하기") — ported from MediNote's 질문 노트 (services/claudeService.ts
// streamThreadAnswer + services/threadFormat.ts uncitedClaims).
// Same reader profile, same evidence-first system prompt, same citation handling:
// the app numbers sources from the API's citations ([n]), lists references,
// strips numbers the model writes itself, flags uncited factual claims, and
// splits off the follow-up questions. MedDaily adds only the card being read.
// ============================================================================
import { ChatMessage, RecallQuestion, Source, StudyContent } from '../types';

const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL_SMART = 'claude-sonnet-5';   // same as MediNote's 질문 노트
const MODEL_FAST = 'claude-haiku-5-5';   // review-question maker (cheap, forced tool)

// ----------------------------------------------------------------------------
// Prompts (verbatim from MediNote)
// ----------------------------------------------------------------------------
const READER_PROFILE = `
READER PROFILE (applies to everything you write):
- The reader is a physician in subspecialty (fellowship) training in cardiology at a large
  tertiary academic center in Korea, with advanced focus on electrophysiology and
  interventional cardiology. Their notes also cover general internal medicine and other
  clinical topics they run into at work (e.g., wound care, procedures, ward management).
- Write at that level. Skip textbook basics and definitions they already know. Prioritize:
  exact guideline thresholds and class of recommendation/level of evidence (ACC/AHA, ESC,
  ASE, HRS/EHRA, KSC where relevant), landmark and recent trial data, device and procedural
  specifics, practical pitfalls, and areas of controversy or where guidelines disagree.
- Use standard English medical terms and abbreviations as used in clinical practice without
  spelling out common ones (e.g., LVEF, PVI, CTI, TAVR, CRT-D, GDMT); Korean is fine for the
  connecting prose — unless an OUTPUT LANGUAGE other than Korean is specified, in which case that
  language overrides this.
- For topics outside cardiology, keep the same attending-level density but do not invent
  subspecialty depth the note doesn't support.
- If something in the source is uncertain, outdated, or guideline-discordant, say so briefly
  instead of smoothing it over.
- Style: plain, calm text. Do NOT use emoji or decorative symbols (no ⚠️ ✅ ❌ 🔥 📌 ✨ etc.).
  When something needs a flag, write a short bold word instead, e.g. "**주의**", "**확인 필요**",
  "**변경됨**" (or the equivalent word in the output language). Arrows (→), ≥/≤ and plain bullets are fine.
`;

const FOLLOWUP_MARKER = '%%NEXT%%';

const THREAD_SYSTEM = `
    You are an attending-level colleague in a specialist medical discussion with the reader. The conversation is kept
    as their study notes and will be re-read and quizzed, so OBJECTIVE, VERIFIABLE EVIDENCE IS THE TOP PRIORITY —
    above completeness, above speed, above sounding fluent. An unsupported statement is worse than a missing one.
    ${READER_PROFILE}

    EVIDENCE FIRST (mandatory):
    1. Before writing, list for yourself every factual claim the answer will need: guideline recommendations (COR/LOE),
       diagnostic thresholds, drug doses/levels/interactions, contraindications, trial results (effect size, CI,
       event rates), epidemiology, assay or device behaviour, and anything the reader could act on.
    2. Search for them FIRST (up to 8 searches), with targeted queries — guideline name + year + topic, trial acronym,
       or "PubMed <drug> <effect>". Prefer, in order: current society guideline documents (ACC/AHA, ESC, HRS/EHRA,
       KSC, KDIGO, AASLD …) → the original trial/meta-analysis publication (NEJM, Lancet, JAMA, EHJ, JACC, Circulation,
       PubMed) → drug labels (FDA/EMA) → high-quality reviews. Never use blogs, forums, news or SEO health sites.
    3. Then write, and state each such claim ONLY from what you retrieved, so it carries a citation. In the sentence,
       name the source the way a specialist would: society + guideline + year + COR/LOE, or trial name + journal + year,
       or "FDA label".
    4. Before finishing, re-check every sentence that contains a number, threshold, dose, recommendation, contraindication
       or trial result. If it is not backed by a source you retrieved: search specifically for it. If you still find
       nothing, either drop the sentence (preferred when it is peripheral) or keep it only with "(출처 미확인)".
       "(출처 미확인)" is a last resort after a specific search — never a substitute for searching.
    5. Distinguish clearly: guideline recommendation vs trial finding vs expert opinion/consensus vs your own clinical
       reasoning (label the latter "임상적 추론"). Say when evidence is weak, observational, extrapolated or conflicting,
       and when guidelines (e.g. ACC/AHA vs ESC) disagree.
    6. Never invent numbers, trials, guideline classes or citations. If you are not sure of an exact value, say so.
    7. Do NOT write your own bracket numbers like [1] or a reference list — the app numbers the citations and lists
       the references automatically from your searches.
    - Pure mechanisms/definitions that are textbook-level may be explained without a search, but any specific number
      inside them still needs a source.

    HOW TO ANSWER:
    - Answer the question directly first (1~2 sentences), then the supporting evidence and detail a specialist needs —
      mechanism, thresholds/doses with units, COR/LOE and year, landmark trials with key results, practical pitfalls.
      Fellow/attending-level discussion; skip basics they obviously know. If the reader's premise is wrong or
      outdated, say so directly with the evidence.
    - When the question quotes part of an earlier answer, focus on exactly that part.
    - When photos are attached (ECG, EGM/intracardiac tracing, echo, angiogram, CT, lab table, slide, handwritten note),
      read them directly: describe what you actually see that matters, then answer. Say clearly when image quality or
      cropping limits the reading, and do not invent values that are not visible.
    - Format: Markdown. Use "###" for any headings (never "#" or "##"), bullets "- " with the full sentence on the same
      line, ≥/≤ instead of LaTeX. Tables are fine for comparisons (plain text cells).
    - Write in Korean with standard English medical terms/abbreviations, unless the reader writes in another language.
    - Output only the answer — no narration of your process ("검색해보겠습니다" etc.).

    AFTER THE ANSWER (always, briefly): on a new line write exactly ${FOLLOWUP_MARKER} and then 3 follow-up questions,
    one per line starting with "- ", in Korean (≤ 40 characters each). Pick what a fellow would most likely want to ask
    next or should not miss: a practical pitfall, an adjacent decision, a special population, a conflicting guideline,
    a landmark trial worth knowing. Questions only — no statements, no numbers, no citations, no searching for them.
    Do not repeat what the answer already covered. Nothing after them.
`;

const FAST_MODE_NOTE = `(앱 설정 — 빠른 모드) 이번 답은 짧게: 핵심만 5~8줄.
- 짧아도 근거는 필수: 쓰기 전에 반드시 web_search를 1~3회 해서 이 답의 핵심 수치·권고·시험 결과를 확인하고, 그 검색 결과에서 인용해 쓸 것.
  검색 없이 기억만으로 답하지 말 것. 순수한 기전·정의만 묻는 질문이 아니면 검색을 건너뛰지 말 것.
- 출처를 붙이지 못한 수치·권고·시험 결과는 빼거나 "(출처 미확인)".
- [1] 같은 번호나 참고문헌 목록을 직접 쓰지 말 것(앱이 검색 인용에서 자동으로 붙임). 검색 결과 영어 원문을 길게 그대로 옮기지 말고 한국어로 요약.
- 이 안내 자체("빠른 모드" 등)는 답에 언급하지 말 것.`;

const FAST_RETRY_NOTE = `(앱 확인) 직전 시도는 출처가 연결되지 않은 답이라 앱이 받지 않았음(검색을 안 했거나, 인용 대신 [n] 번호를 직접 씀).
이번에는 반드시 먼저 web_search로 핵심 수치·권고·시험 결과를 확인하고, 그 검색 결과를 인용해 짧게 답할 것. 번호는 직접 쓰지 말 것.`;

export const REINFORCE_INSTRUCTION = (answer: string) => `
(앱 요청 — 근거 보강) 위 질문에 대한 아래 답변에서 출처 없이 쓰인 사실 진술(수치·용량·농도·권고 등급·금기·임상시험 결과·
역학·검사/기기 특성 등)을 하나씩 찾아, 각각을 구체적으로 검색해 근거를 확인한 뒤 답변 전체를 다시 써줘.
- 근거가 확인된 진술은 출처를 붙여 그대로 두거나 근거에 맞게 고쳐.
- 근거와 다르면 근거대로 바로잡고, 무엇이 바뀌었는지 문장 안에서 짧게 밝혀.
- 검색해도 근거를 못 찾은 진술은 지엽적이면 빼고, 꼭 필요하면 "(출처 미확인)"을 붙여.
- 구성과 분량은 원래 답변과 비슷하게. 다시 쓴 답변 본문만 출력.

[원래 답변]
"""
${answer.replace(/\[(\d{1,2})\]/g, '')}
"""`;

// MedDaily addition: the card the reader is looking at
const cardContext = (card: StudyContent) => `
THE PAGE THE READER IS STUDYING RIGHT NOW (a study card the app generated earlier). Questions usually refer to it
("이거", "위 내용", "여기서 말한 …"). Treat it as context, not as evidence: it may contain errors. If your search shows
something on the card is wrong or outdated, say so plainly with the evidence.

Title: ${card.title}
"""
${card.content}
"""`;

// ----------------------------------------------------------------------------
// Depth: auto picks fast (short, 1-3 searches, effort medium) or full
// (evidence-centred, up to 8 searches, default effort) per question.
// ----------------------------------------------------------------------------
export type ChatMode = 'fast' | 'full';
export type ChatModeSetting = 'auto' | ChatMode;

const DEEP_RE = /근거|가이드라인|지침|권고|임상\s?시험|연구|논문|메타|최신|업데이트|개정|비교|차이|vs\.?|versus|용량|투여|dose|dosing|기준|cut-?\s?off|역치|목표치|금기|상호작용|interaction|evidence|guideline|trial|study|recommend|COR|LOE|자세히|정확히|논란|controvers|ガイドライン|根拠|試験|用量|比較/i;

export const chooseMode = (question: string): ChatMode =>
  (DEEP_RE.test(question) || question.trim().length > 80) ? 'full' : 'fast';

// ----------------------------------------------------------------------------
// Citation helpers (from MediNote)
// ----------------------------------------------------------------------------
const CITE_TAG = '⁣'; // invisible marker in front of numbers the app adds
const ORPHAN_RE = /( *)(⁣)?\[\d{1,2}(?:\s*[,–-]\s*\d{1,2})*\]/g;
const dropOrphanCites = (t: string): { text: string; orphans: number } => {
  let orphans = 0;
  const text = t.replace(ORPHAN_RE, (m, _sp, tag) => { if (tag) return m; orphans++; return ''; }).split(CITE_TAG).join('');
  return { text, orphans };
};

export const splitFollowups = (raw: string, streaming = false): { body: string; followups: string[] } => {
  const at = raw.indexOf(FOLLOWUP_MARKER);
  if (at < 0) {
    let body = raw;
    if (streaming) {
      for (let k = Math.min(FOLLOWUP_MARKER.length - 1, body.length); k > 0; k--) {
        if (body.endsWith(FOLLOWUP_MARKER.slice(0, k))) { body = body.slice(0, -k); break; }
      }
    }
    return { body, followups: [] };
  }
  const followups = raw.slice(at + FOLLOWUP_MARKER.length).split('\n')
    .map(l => l.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').replace(/\[\d{1,2}\]/g, '').replace(/\*\*/g, '').trim())
    .filter(l => l.length >= 4)
    .map(l => (l.length > 80 ? l.slice(0, 80) + '…' : l))
    .slice(0, 4);
  return { body: raw.slice(0, at).trimEnd(), followups };
};

// Factual sentences (numbers, units, COR/LOE, trials, doses …) without a citation number
const FACT_RE = /(\d+(?:\.\d+)?\s*(?:%|mg|mcg|μg|ng|pg|g\/dL|mmol|mEq|mmHg|ms|mm|cm|bpm|kg|IU|U\/L|mL|ml|배|시간|일|주|개월|년)\b|\d+(?:\.\d+)?\s*(?:%|배|시간|일|주|개월|년)|\b(?:COR|LOE|Class\s*(?:I{1,3}|IIa|IIb|1|2a|2b|3)|HR|OR|RR|NNT|CI|RCT|trial|meta-analysis|guideline|FDA|label)\b|가이드라인|권고|금기|임상시험|연구에서|보고|용량|농도|목표치|역치|발생률|사망률)/i;
const CITE_RE = /\[\d{1,2}\]/;
export const uncitedClaims = (text: string, maxCite?: number): string[] => {
  const hasCite = (t: string) => {
    if (maxCite === undefined) return CITE_RE.test(t);
    return Array.from(t.matchAll(/\[(\d{1,2})\]/g)).some(m => Number(m[1]) >= 1 && Number(m[1]) <= maxCite);
  };
  const out: string[] = [];
  let inCode = false;
  (text || '').split('\n').forEach(raw => {
    const line = raw.trim();
    if (/^```/.test(line)) { inCode = !inCode; return; }
    if (inCode || !line || /^#{1,6}\s/.test(line) || /^>\s*참고:/.test(line) || /^\|?\s*-{3,}/.test(line)) return;
    const units = line.length > 160 ? line.split(/(?<=[.!?]|다\.)\s+/) : [line];
    units.forEach(u => {
      const t = u.replace(/^[-*]\s+|^\d+\.\s+/, '').trim();
      if (t.length < 12) return;
      if (t.includes('출처 미확인') || (FACT_RE.test(t) && !hasCite(t))) out.push(t);
    });
  });
  return out;
};

// ----------------------------------------------------------------------------
// Messages with history trimming + cache points (simplified from MediNote)
// ----------------------------------------------------------------------------
const HISTORY_CHARS = 20000;
const TRIM_STEP = 6;
const CACHE = { type: 'ephemeral', ttl: '1h' } as const;
const stripCiteNumbers = (t: string) => (t || '').replace(/\[(\d{1,2})\]/g, '');

const buildMessages = (history: ChatMessage[], question: string, extra?: string) => {
  const turnText = (m: ChatMessage) => m.role === 'assistant' ? stripCiteNumbers(m.text) : m.text;
  let used = question.length;
  let sMin = history.length;
  for (let i = history.length - 1; i >= 0; i--) {
    const len = turnText(history[i]).length;
    if (used + len > HISTORY_CHARS) break;
    used += len;
    sMin = i;
  }
  // round the start up to a multiple of 6 so the cached prefix stays stable
  const start = sMin === 0 ? 0 : Math.min(history.length, Math.ceil(sMin / TRIM_STEP) * TRIM_STEP);
  const picked = history.slice(start);

  const merged: { role: 'user' | 'assistant'; content: any[] }[] = [];
  [...picked.map(m => ({ role: m.role, text: turnText(m) })), { role: 'user' as const, text: question }].forEach(t => {
    const last = merged[merged.length - 1];
    if (last && last.role === t.role) last.content.push({ type: 'text', text: t.text });
    else merged.push({ role: t.role, content: [{ type: 'text', text: t.text }] });
  });
  while (merged.length && merged[0].role !== 'user') merged.shift();
  if (start > 0 && merged.length) merged[0].content.unshift({ type: 'text', text: '(앞부분 대화는 길어서 생략됨)' });

  const qi = merged.length - 1;
  const qm = merged[qi];
  qm.content[qm.content.length - 1] = { ...qm.content[qm.content.length - 1], cache_control: CACHE };
  if (qi >= 1) {
    const prev = merged[qi - 1];
    prev.content[prev.content.length - 1] = { ...prev.content[prev.content.length - 1], cache_control: CACHE };
  }
  if (extra) qm.content.push({ type: 'text', text: extra });
  return merged;
};

// ----------------------------------------------------------------------------
// Streaming answer
// ----------------------------------------------------------------------------
export type ChatStatus = 'searching' | 'writing' | 'recheck';

export interface ChatStreamParams {
  card: StudyContent;
  history: ChatMessage[];
  question: string;
  mode: ChatMode;
  instruction?: string;              // one-off extra instruction (e.g. reinforce)
  onText?: (text: string) => void;
  onStatus?: (s: ChatStatus) => void;
  onSources?: (s: Source[]) => void;
  signal?: AbortSignal;
}

export interface ChatStreamResult {
  text: string; sources: Source[]; seen: Source[]; queries: string[]; followups: string[];
  truncated: boolean; orphanCites: number;
}

export const streamChatAnswer = async (params: ChatStreamParams): Promise<ChatStreamResult> => {
  const fast = params.mode === 'fast';
  const extras = [params.instruction, fast ? FAST_MODE_NOTE : undefined].filter(Boolean).join('\n\n') || undefined;
  const first = await streamOnce(params, extras);
  // Fast-mode safety net (MediNote §5-61/§5-65): factual answer with no linked source → ask once more
  const noLinkedSource = first.sources.length === 0 && (first.seen.length === 0 || first.orphanCites > 0);
  if (!fast || !noLinkedSource || first.truncated || params.signal?.aborted) return first;
  if (uncitedClaims(first.text).length === 0) return first;
  params.onStatus?.('recheck');
  params.onText?.('');
  params.onSources?.([]);
  try {
    const second = await streamOnce(params, `${FAST_MODE_NOTE}\n\n${FAST_RETRY_NOTE}`);
    const firstSeen = [...first.sources, ...first.seen].filter(s => !second.sources.some(x => x.uri === s.uri) && !second.seen.some(x => x.uri === s.uri));
    return { ...second, seen: [...second.seen, ...firstSeen], queries: Array.from(new Set([...first.queries, ...second.queries])) };
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    return first;
  }
};

const streamOnce = async (params: ChatStreamParams, extra?: string): Promise<ChatStreamResult> => {
  const fast = params.mode === 'fast';
  const body: Record<string, any> = {
    model: MODEL_SMART,
    max_tokens: fast ? 16000 : 32000,
    system: [
      { type: 'text', text: THREAD_SYSTEM, cache_control: CACHE },
      { type: 'text', text: cardContext(params.card), cache_control: CACHE }
    ],
    messages: buildMessages(params.history, params.question, extra),
    // same tool definition in both modes so the cache survives a mode switch
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
    stream: true
  };
  if (fast) body.output_config = { effort: 'medium' };

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey || '',
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify(body),
    signal: params.signal
  });
  if (!response.ok || !response.body) {
    let errBody: any = null;
    try { errBody = await response.json(); } catch { /* ignore */ }
    throw new Error(`Claude API error (${response.status} ${errBody?.error?.type || ''}): ${errBody?.error?.message || response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const blockTypes = new Map<number, string>();
  const sources = new Map<string, Source & { n: number }>();
  const blockCites = new Map<number, Set<number>>();
  const seen = new Map<string, Source>();
  const queries: string[] = [];
  const toolInput = new Map<number, string>();
  let text = '';
  let stopReason = '';
  let buf = '';
  let lastStartedType = '';

  const emitText = () => params.onText?.(splitFollowups(dropOrphanCites(text).text, true).body);

  const handle = (evt: any) => {
    switch (evt?.type) {
      case 'content_block_start': {
        const type = evt.content_block?.type || '';
        blockTypes.set(evt.index, type);
        if (type === 'server_tool_use') params.onStatus?.('searching');
        if (type === 'web_search_tool_result' && Array.isArray(evt.content_block?.content)) {
          evt.content_block.content.forEach((r: any) => {
            if (r?.type !== 'web_search_result' || typeof r.url !== 'string' || seen.has(r.url) || seen.size >= 40) return;
            seen.set(r.url, { title: (r.title || r.url).trim(), uri: r.url });
          });
        }
        if (type === 'text') {
          if (text && lastStartedType && lastStartedType !== 'text' && !text.endsWith('\n\n')) text += '\n\n';
          params.onStatus?.('writing');
        }
        lastStartedType = type;
        break;
      }
      case 'content_block_delta': {
        const d = evt.delta || {};
        if (d.type === 'input_json_delta' && blockTypes.get(evt.index) === 'server_tool_use') {
          toolInput.set(evt.index, (toolInput.get(evt.index) || '') + (d.partial_json || ''));
        } else if (d.type === 'text_delta' && blockTypes.get(evt.index) === 'text') {
          text += d.text || '';
          emitText();
        } else if (d.type === 'citations_delta' && d.citation?.url) {
          const c = d.citation;
          let src = sources.get(c.url);
          if (!src) {
            src = { n: sources.size + 1, title: (c.title || c.url).trim(), uri: c.url };
            sources.set(c.url, src);
          }
          const excerpt = typeof c.cited_text === 'string' ? c.cited_text.replace(/\s+/g, ' ').trim() : '';
          if (excerpt && !src.snippet) src.snippet = excerpt.length > 220 ? excerpt.slice(0, 220) + '…' : excerpt;
          const set = blockCites.get(evt.index) || new Set<number>();
          set.add(src.n);
          blockCites.set(evt.index, set);
          params.onSources?.(Array.from(sources.values()).map(({ n, ...s }) => s));
        }
        break;
      }
      case 'content_block_stop': {
        if (blockTypes.get(evt.index) === 'server_tool_use') {
          try {
            const q = JSON.parse(toolInput.get(evt.index) || '{}')?.query;
            if (typeof q === 'string' && q.trim()) queries.push(q.trim());
          } catch { /* ignore */ }
        }
        // a cited text block just ended → append its source numbers [n]
        const nums = blockCites.get(evt.index);
        if (nums && nums.size) {
          const marker = Array.from(nums).sort((a, b) => a - b).map(n => `${CITE_TAG}[${n}]`).join('');
          const m = /(\s*)$/.exec(text);
          const tail = m ? m[1] : '';
          text = text.slice(0, text.length - tail.length) + marker + tail;
          emitText();
        }
        break;
      }
      case 'message_delta':
        if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
        break;
      case 'error':
        throw new Error(`Claude API error (stream): ${evt.error?.message || evt.error?.type || 'unknown'}`);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const data = raw.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
      if (!data) continue;
      let evt: any;
      try { evt = JSON.parse(data); } catch { continue; }
      handle(evt);
    }
  }

  if (stopReason === 'refusal') throw new Error('Safety: content blocked by the model (refusal)');
  const cleaned = dropOrphanCites(text);
  const split = splitFollowups(cleaned.text);
  text = split.body.trim();
  if (!text) {
    throw new Error(stopReason === 'max_tokens'
      ? '답변을 쓰기 전에 분량 한도에 걸렸습니다. 질문을 조금 좁혀서 다시 시도해주세요.'
      : 'AI가 답변을 돌려주지 않았습니다. 잠시 후 다시 시도해주세요.');
  }
  const truncated = stopReason === 'max_tokens' || stopReason === 'pause_turn';
  if (truncated) text += '\n\n> 참고: 답변이 중간에 끊겼습니다. "이어서 설명해줘"라고 물어보면 이어집니다.';
  const list = Array.from(sources.values()).sort((a, b) => a.n - b.n).map(({ n, ...s }) => s);
  const seenList = Array.from(seen.values()).filter(s => !sources.has(s.uri));
  return { text, sources: list, seen: seenList, queries, followups: split.followups, truncated, orphanCites: cleaned.orphans };
};

// ----------------------------------------------------------------------------
// Review question from one Q&A (so the conversation joins spaced review)
// ----------------------------------------------------------------------------
const REVIEW_TOOL = {
  name: 'submit_review_question',
  description: 'Submit one O/X review question made from the answer, or mark that none is worthwhile.',
  input_schema: {
    type: 'object',
    properties: {
      worthReviewing: { type: 'boolean', description: 'false if the answer has no concrete, testable medical fact (e.g. small talk, pure clarification)' },
      fact: { type: 'string', description: 'The single most important concrete fact stated in the answer (prefer one that carries a citation number)' },
      statement: { type: 'string', description: 'Self-contained true/false statement testing that fact. Name the disease/drug/test; never "this answer". About half the time make it false by changing ONE key detail plausibly (number, threshold, first-line choice, direction of effect).' },
      explanation: { type: 'string', description: '1-2 sentences stating the correct fact and why, in the answer language' },
      isTrue: { type: 'boolean', description: 'Decide last, after checking the statement against fact.' }
    },
    required: ['worthReviewing', 'fact', 'statement', 'explanation', 'isTrue']
  }
};

export const makeReviewQuestion = async (question: string, answer: string): Promise<RecallQuestion | null> => {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey || '',
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: MODEL_FAST,
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `Make one O/X spaced-review question from this medical Q&A. Use only facts the answer states; write in the answer's language (Korean prose with standard English medical terms if the answer is Korean).\n\n[Question]\n${question}\n\n[Answer]\n${stripCiteNumbers(answer)}`
        }],
        tools: [REVIEW_TOOL],
        tool_choice: { type: 'tool', name: REVIEW_TOOL.name }
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const input = (data.content || []).find((b: any) => b.type === 'tool_use')?.input;
    if (!input || !input.worthReviewing || typeof input.statement !== 'string' || typeof input.isTrue !== 'boolean') return null;
    return { statement: input.statement.trim(), isTrue: input.isTrue, explanation: String(input.explanation || input.fact || '').trim() };
  } catch {
    return null;
  }
};
