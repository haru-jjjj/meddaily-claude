import React, { useEffect, useState } from 'react';
import { Language, MedicalImage } from '../types';
import { fetchMedicalImages } from '../services/imageService';

interface ImagePanelProps {
  queries: string[];
  language: Language;
}

const LABELS = {
  [Language.KOREAN]: {
    show: '관련 그림·사진 보기',
    loading: '그림을 찾는 중...',
    none: '맞는 그림을 찾지 못했어요.',
    retry: '다시 찾기',
    original: '원문 보기',
    close: '닫기',
    note: '검색어 기반 결과라 주제와 다른 그림이 섞일 수 있어요. 캡션을 확인하세요.'
  },
  [Language.ENGLISH]: {
    show: 'Show related images',
    loading: 'Searching images...',
    none: 'No matching images found.',
    retry: 'Try again',
    original: 'Open source',
    close: 'Close',
    note: 'Results are keyword-based and may include unrelated images. Check the caption.'
  },
  [Language.JAPANESE]: {
    show: '関連する図・画像を見る',
    loading: '画像を検索中...',
    none: '該当する画像が見つかりませんでした。',
    retry: '再検索',
    original: '出典を開く',
    close: '閉じる',
    note: 'キーワード検索の結果のため、関係のない画像が含まれることがあります。キャプションを確認してください。'
  }
};

export const ImagePanel: React.FC<ImagePanelProps> = ({ queries, language }) => {
  const L = LABELS[language] || LABELS[Language.ENGLISH];
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [images, setImages] = useState<MedicalImage[]>([]);
  const [selected, setSelected] = useState<MedicalImage | null>(null);
  const queryKey = queries.join('|');

  // Reset whenever the article (and therefore its queries) changes
  useEffect(() => {
    setStatus('idle');
    setImages([]);
    setSelected(null);
  }, [queryKey]);

  // Lock background scroll while the enlarged view is open
  useEffect(() => {
    if (!selected) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [selected]);

  if (queries.length === 0) return null;

  const load = async () => {
    setStatus('loading');
    const result = await fetchMedicalImages(queries);
    setImages(result);
    setStatus('done');
  };

  return (
    <div className="not-prose mt-8 pt-6 border-t border-slate-200">
      {status === 'idle' && (
        <button
          onClick={load}
          className="w-full py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 font-semibold text-sm hover:bg-blue-50 hover:text-blue-700 transition-colors"
        >
          {L.show}
        </button>
      )}

      {status === 'loading' && (
        <div className="w-full py-6 text-center text-sm text-slate-500">{L.loading}</div>
      )}

      {status === 'done' && images.length === 0 && (
        <div className="w-full py-4 text-center text-sm text-slate-500">
          {L.none}
          <button onClick={load} className="ml-2 underline text-slate-600">{L.retry}</button>
        </div>
      )}

      {status === 'done' && images.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3">
            {images.map((img, i) => (
              <button
                key={img.full + i}
                onClick={() => setSelected(img)}
                className="text-left rounded-xl overflow-hidden border border-slate-200 bg-white"
              >
                <div className="aspect-square bg-slate-100 flex items-center justify-center overflow-hidden">
                  <img
                    src={img.thumb}
                    alt={img.caption}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="p-2">
                  <p className="text-xs text-slate-700 leading-snug line-clamp-2">{img.caption || img.sourceTitle}</p>
                  <p className="text-[10px] text-slate-400 mt-1 truncate">
                    {img.provider}{img.license ? ` · ${img.license}` : ''}
                  </p>
                </div>
              </button>
            ))}
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
