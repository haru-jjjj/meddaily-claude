import React, { useEffect, useRef, useState } from 'react';
import { Language, MedicalImage } from '../types';
import { fetchMedicalImages, BATCH_SIZE } from '../services/imageService';

interface ImagePanelProps {
  queries: string[];
  language: Language;
}

const LABELS = {
  [Language.KOREAN]: {
    show: '관련 그림·사진 보기',
    loading: '그림을 찾는 중...',
    none: '맞는 그림을 찾지 못했어요. 아래에서 다른 검색어로 찾아보세요.',
    more: '다른 그림 더 보기',
    noMore: '더 찾은 그림이 없어요.',
    searchLabel: '검색어 바꿔서 찾기',
    placeholder: '영어로 입력 (예: psoriasis plaque)',
    search: '찾기',
    original: '원문 보기',
    close: '닫기',
    note: '검색어 기반 결과라 주제와 다른 그림이 섞일 수 있어요. 캡션을 확인하세요.'
  },
  [Language.ENGLISH]: {
    show: 'Show related images',
    loading: 'Searching images...',
    none: 'No matching images. Try another search term below.',
    more: 'Show more images',
    noMore: 'No more images found.',
    searchLabel: 'Search with other terms',
    placeholder: 'e.g. psoriasis plaque',
    search: 'Search',
    original: 'Open source',
    close: 'Close',
    note: 'Results are keyword-based and may include unrelated images. Check the caption.'
  },
  [Language.JAPANESE]: {
    show: '関連する図・画像を見る',
    loading: '画像を検索中...',
    none: '該当する画像が見つかりませんでした。下で別の検索語を試してください。',
    more: '別の画像をもっと見る',
    noMore: 'これ以上画像は見つかりませんでした。',
    searchLabel: '検索語を変えて探す',
    placeholder: '英語で入力（例: psoriasis plaque）',
    search: '検索',
    original: '出典を開く',
    close: '閉じる',
    note: 'キーワード検索の結果のため、関係のない画像が含まれることがあります。キャプションを確認してください。'
  }
};

export const ImagePanel: React.FC<ImagePanelProps> = ({ queries, language }) => {
  const L = LABELS[language] || LABELS[Language.ENGLISH];
  const [opened, setOpened] = useState(false);
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<MedicalImage[]>([]);
  const [activeQueries, setActiveQueries] = useState<string[]>(queries);
  const [exhausted, setExhausted] = useState(false);
  const [customQuery, setCustomQuery] = useState('');
  const [selected, setSelected] = useState<MedicalImage | null>(null);
  const pageRef = useRef(0);
  const requestRef = useRef(0);
  const queryKey = queries.join('|');

  // Reset whenever the article (and therefore its queries) changes
  useEffect(() => {
    requestRef.current++;
    setOpened(false);
    setLoading(false);
    setImages([]);
    setActiveQueries(queries);
    setExhausted(false);
    setCustomQuery('');
    setSelected(null);
    pageRef.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  // Lock background scroll while the enlarged view is open
  useEffect(() => {
    if (!selected) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [selected]);

  // Loads the next batch for the given queries. `reset` starts a fresh list.
  const loadBatch = async (qs: string[], reset: boolean) => {
    const myRequest = ++requestRef.current;
    setOpened(true);
    if (qs.length === 0) { setLoading(false); return; }
    setLoading(true);
    if (reset) {
      pageRef.current = 0;
      setImages([]);
      setExhausted(false);
    }
    const already = new Set((reset ? [] : images).map(i => i.full));
    const found: MedicalImage[] = [];
    let gotNothing = false;
    // Try up to two pages so a batch isn't left short by duplicates.
    for (let attempt = 0; attempt < 2 && found.length < BATCH_SIZE; attempt++) {
      const batch = await fetchMedicalImages(qs, pageRef.current, new Set([...already, ...found.map(i => i.full)]));
      pageRef.current += 1;
      if (batch.length === 0) { gotNothing = true; break; }
      found.push(...batch.slice(0, BATCH_SIZE - found.length));
    }
    if (myRequest !== requestRef.current) return; // superseded
    setImages(prev => (reset ? found : [...prev, ...found]));
    if (gotNothing && found.length === 0) setExhausted(true);
    setLoading(false);
  };

  const searchWith = (qs: string[]) => {
    const clean = qs.map(q => q.trim()).filter(Boolean);
    if (clean.length === 0) return;
    setActiveQueries(clean);
    loadBatch(clean, true);
  };

  return (
    <div className="not-prose mt-8 pt-6 border-t border-slate-200">
      {!opened && (
        <button
          onClick={() => loadBatch(activeQueries.length ? activeQueries : queries, true)}
          className="w-full py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 font-semibold text-sm hover:bg-blue-50 hover:text-blue-700 transition-colors"
        >
          {L.show}
        </button>
      )}

      {opened && (
        <>
          {images.length > 0 && (
            <div className="space-y-4">
              {images.map((img, i) => (
                <button
                  key={img.full + i}
                  onClick={() => setSelected(img)}
                  className="block w-full text-left rounded-xl overflow-hidden border border-slate-200 bg-white"
                >
                  <div className="bg-slate-100 flex items-center justify-center">
                    <img
                      src={img.thumb}
                      alt={img.caption}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="w-full max-h-72 object-contain"
                    />
                  </div>
                  <div className="p-3">
                    <p className="text-sm text-slate-700 leading-snug line-clamp-3">{img.caption || img.sourceTitle}</p>
                    <p className="text-[11px] text-slate-400 mt-1 truncate">
                      {img.provider}{img.license ? ` · ${img.license}` : ''}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {loading && (
            <div className="w-full py-5 text-center text-sm text-slate-500">{L.loading}</div>
          )}

          {!loading && images.length === 0 && (
            <div className="w-full py-3 text-center text-sm text-slate-500">{L.none}</div>
          )}

          {!loading && images.length > 0 && (
            exhausted ? (
              <p className="mt-3 text-center text-xs text-slate-400">{L.noMore}</p>
            ) : (
              <button
                onClick={() => loadBatch(activeQueries, false)}
                className="mt-4 w-full py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50"
              >
                {L.more}
              </button>
            )
          )}

          {/* Re-search: tap one of the AI's search terms, or type your own */}
          <div className="mt-5">
            <p className="text-xs font-semibold text-slate-500 mb-2">{L.searchLabel}</p>
            {queries.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {queries.map((q) => {
                  const active = activeQueries.length === 1 && activeQueries[0] === q;
                  return (
                    <button
                      key={q}
                      onClick={() => searchWith([q])}
                      disabled={loading}
                      className={`px-3 py-1.5 rounded-full text-xs border transition-colors disabled:opacity-50 ${
                        active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {q}
                    </button>
                  );
                })}
              </div>
            )}
            <form
              className="flex gap-2"
              onSubmit={(e) => { e.preventDefault(); searchWith([customQuery]); }}
            >
              <input
                type="text"
                value={customQuery}
                onChange={(e) => setCustomQuery(e.target.value)}
                placeholder={L.placeholder}
                className="flex-1 min-w-0 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={loading || !customQuery.trim()}
                className="px-4 py-2 text-sm rounded-lg bg-slate-800 text-white disabled:opacity-40"
              >
                {L.search}
              </button>
            </form>
          </div>

          <p className="text-[11px] text-slate-400 mt-3">{L.note}</p>
        </>
      )}

      {selected && (
        <div
          className="fixed inset-0 z-[60] bg-black/85 flex flex-col"
          onClick={() => setSelected(null)}
        >
          <div className="flex justify-end p-3">
            <button
              onClick={() => setSelected(null)}
              className="px-3 py-1.5 rounded-full bg-white/15 text-white text-sm"
            >
              {L.close}
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center px-3 min-h-0">
            <img
              src={selected.full}
              alt={selected.caption}
              referrerPolicy="no-referrer"
              className="max-w-full max-h-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div
            className="bg-black/60 text-white p-4 max-h-[35vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm leading-relaxed">{selected.caption}</p>
            <p className="text-xs text-white/60 mt-2">
              {selected.sourceTitle}
              {selected.license ? ` · ${selected.license}` : ''} · {selected.provider}
            </p>
            <a
              href={selected.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-3 text-sm text-blue-300 underline"
            >
              {L.original}
            </a>
          </div>
        </div>
      )}
    </div>
  );
};
