import React, { useState, useEffect, useRef } from 'react';
import { DEFAULT_CATEGORY } from './constants';
import { SubCategory, StudyContent, Language, StudyLength, Series, ChatMessage } from './types';
import { generateMedicalTopic, rewriteContent, generateTopicFromKeyword, DraftHandler, setStudyContext, planSeries, generateSeriesPart } from './services/claudeService';
import { store, type SyncStatus } from './services/store';
import { newId } from './services/id';
import { initialReview, answerReview, dueItems, countBySpecialty, ReviewItem } from './services/review';
import { ChatPanel } from './components/ChatPanel';
import { BottomNav, View } from './components/BottomNav';
import { HistoryView } from './components/HistoryView';
import { ReviewView } from './components/ReviewView';
import { SeriesView } from './components/SeriesView';
import { labelsFor } from './components/labels';
import { Button } from './components/Button';
import { Loading } from './components/Loading';
import { SourceList } from './components/SourceList';
import { SettingsModal } from './components/SettingsModal';
import { ImagePanel } from './components/ImagePanel';
import { Flowchart } from './components/Flowchart';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';

const markdownComponents: any = {
  h1: ({node, ...props}: any) => <h2 className="text-2xl font-bold text-slate-800 mt-8 mb-4" {...props} />,
  h2: ({node, ...props}: any) => <h3 className="text-xl font-semibold text-slate-800 mt-6 mb-3" {...props} />,
  h3: ({node, ...props}: any) => <h4 className="text-lg font-medium text-slate-800 mt-4 mb-2" {...props} />,
  p: ({node, ...props}: any) => <p className="mb-4 text-lg" {...props} />,
  ul: ({node, ...props}: any) => <ul className="list-disc pl-5 mb-4 space-y-2" {...props} />,
  li: ({node, ...props}: any) => <li className="pl-1" {...props} />,
  strong: ({node, ...props}: any) => <strong className="font-semibold text-slate-900" {...props} />,
  blockquote: ({node, ...props}: any) => <blockquote className="border-l-4 border-blue-500 pl-4 py-1 italic bg-slate-50 text-slate-600 rounded-r-lg my-6" {...props} />,
  table: ({node, ...props}: any) => <div className="overflow-x-auto mb-6"><table className="min-w-full border-collapse border border-slate-200" {...props} /></div>,
  thead: ({node, ...props}: any) => <thead className="bg-slate-50" {...props} />,
  th: ({node, ...props}: any) => <th className="border border-slate-200 px-4 py-2 text-left font-semibold text-slate-700 text-sm whitespace-nowrap" {...props} />,
  td: ({node, ...props}: any) => <td className="border border-slate-200 px-4 py-2 text-sm text-slate-600" {...props} />,
};

const App: React.FC = () => {
  // hasStarted = the user picked settings and started a random/category session
  // (enables auto-prefetch). Cards can also be opened from history/series without it.
  const [hasStarted, setHasStarted] = useState(false);

  // --- Tabs + synced data (history, review, series) ---
  const [view, setView] = useState<View>('study');
  const [cards, setCards] = useState<StudyContent[]>([]);
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [sync, setSync] = useState<{ status: SyncStatus; message?: string }>({ status: store.mode === 'local' ? 'local' : 'connecting' });
  const [creatingSeries, setCreatingSeries] = useState(false);
  const [reviewBannerHidden, setReviewBannerHidden] = useState(false);

  useEffect(() => {
    const u1 = store.subscribeCards(setCards);
    const u2 = store.subscribeSeries(setSeriesList);
    const u3 = store.subscribeStatus(setSync);
    return () => { u1(); u2(); u3(); };
  }, []);

  // Feed history into topic selection: weight random mode toward specialties
  // read less in the last 2 weeks, and avoid topics already read on any device.
  useEffect(() => {
    setStudyContext({
      coverage: countBySpecialty(cards),
      topics: cards.slice(0, 60).map(c => c.topic).filter(Boolean)
    });
  }, [cards]);

  const dueCount = dueItems(cards).length;

  // --- Q&A about the current card ---
  const [chatOpen, setChatOpen] = useState(false);
  
  // Main Loading State (Blocking)
  const [loading, setLoading] = useState(false);
  
  // Background Loading State (Non-blocking)
  const [backgroundLoading, setBackgroundLoading] = useState(false);
  
  const [currentContent, setCurrentContent] = useState<StudyContent | null>(null);
  const [nextContent, setNextContent] = useState<StudyContent | null>(null);
  
  // Ref to track fetch operations and handle race conditions (overrides)
  const fetchIdRef = useRef(0);
  const isPrefetching = useRef(false); // Keeps track if auto-prefetch specifically is running

  // Streaming draft shown while a blocking (on-screen) generation is in progress
  const [draft, setDraft] = useState<{ title: string; body: string } | null>(null);
  const blockingIdRef = useRef(0);
  const makeDraftHandler = (id: number): DraftHandler => (d) => {
    if (id === blockingIdRef.current) setDraft(d);
  };

  // Runs a generation that the user is waiting for: shows the text as it is
  // written, and drops the result if the user cancelled in the meantime.
  const runBlocking = async (
    generate: (onDraft: DraftHandler) => Promise<StudyContent>,
    errorMessage: string,
    transform?: (c: StudyContent) => StudyContent
  ): Promise<StudyContent | null> => {
    const id = ++blockingIdRef.current;
    setDraft(null);
    setLoading(true);
    setView('study');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    try {
      let content = await generate(makeDraftHandler(id));
      if (transform) content = transform(content);
      if (id === blockingIdRef.current) {
        setCurrentContent(content);
        return content;
      }
      return null;
    } catch (error) {
      console.error(error);
      if (id === blockingIdRef.current) alert(errorMessage);
      return null;
    } finally {
      if (id === blockingIdRef.current) {
        setLoading(false);
        setDraft(null);
      }
    }
  };

  // Settings State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<SubCategory>(DEFAULT_CATEGORY);
  const [activeLanguage, setActiveLanguage] = useState<Language>(Language.KOREAN);
  const [activeLength, setActiveLength] = useState<StudyLength>(StudyLength.MEDIUM);
  const [isRandomMode, setIsRandomMode] = useState(false);
  const [forceResearchMode, setForceResearchMode] = useState(false);

  // --- Automatic Background Prefetch Logic ---
  const triggerBackgroundPrefetch = async (
      category: SubCategory, 
      isRandom: boolean, 
      language: Language, 
      length: StudyLength, 
      forceResearch: boolean
    ) => {
    if (nextContent) return; // Already have next content
    if (isPrefetching.current) return; // Already auto-prefetching

    // Delay slightly to prioritize rendering current content
    setTimeout(async () => {
      // Re-check nextContent in case it was set during timeout
      if (nextContent) return;
      
      let myId = 0;
      
      try {
        isPrefetching.current = true;
        myId = ++fetchIdRef.current;
        setBackgroundLoading(true);
        console.log("Auto-prefetch started (Flash Model)...");
        
        // Use Flash (useProModel = false) for fast background generation
        const content = await generateMedicalTopic(category, isRandom, language, length, forceResearch);
        
        // Only apply if this is still the latest request
        if (myId === fetchIdRef.current) {
            setNextContent(content);
        }
      } catch (e) {
        console.warn("Auto-prefetch failed", e);
      } finally {
        isPrefetching.current = false;

        // Using a simpler check for setBackgroundLoading:
        // We'll let the active request manage the state.
        if (fetchIdRef.current === myId) {
             setBackgroundLoading(false);
        }
      }
    }, 2000);
  };

  // Automatically trigger prefetch when currentContent changes, and remember it
  // locally so it can be shown during the loading phase of the *next* launch.
  useEffect(() => {
    if (currentContent && hasStarted && !currentContent.seriesId) {
      triggerBackgroundPrefetch(activeCategory, isRandomMode, activeLanguage, activeLength, forceResearchMode);
    }
    if (currentContent) {
      try {
        localStorage.setItem('medDaily_lastContent', JSON.stringify(currentContent));
      } catch (e) {
        console.warn('Failed to persist last content', e);
      }
    }
  }, [currentContent, hasStarted, activeCategory, isRandomMode, activeLanguage, activeLength, forceResearchMode]);

  // Save every card the user actually sees into history (once). Cards that
  // were prefetched but never opened are not saved.
  useEffect(() => {
    if (!currentContent || !currentContent.id || currentContent.readAt) return;
    const now = Date.now();
    store.saveCardIfNew({
      ...currentContent,
      readAt: now,
      review: currentContent.recall ? initialReview(now) : undefined
    }).catch(e => console.warn('Save to history failed', e));
  }, [currentContent]);

  // On launch, just load the last article into memory (does NOT skip the
  // selection screen or touch hasStarted/settings). It's used later, once the
  // user picks their settings and hits Start, to fill the loading screen.
  const [cachedContent, setCachedContent] = useState<StudyContent | null>(null);
  useEffect(() => {
    try {
      const stored = localStorage.getItem('medDaily_lastContent');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.content) setCachedContent(parsed.id ? parsed : { ...parsed, id: newId() });
      }
    } catch (e) {
      console.warn('Failed to load cached content', e);
    }
  }, []);

  // --- Wake Lock Implementation ---
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;
    const isLoading = loading || backgroundLoading;

    const requestWakeLock = async () => {
      if ('wakeLock' in navigator) {
        try {
          wakeLock = await navigator.wakeLock.request('screen');
        } catch (err: any) {
          console.warn(`Wake Lock failed`);
        }
      }
    };

    const releaseWakeLock = async () => {
      if (wakeLock) {
        try {
          await wakeLock.release();
          wakeLock = null;
        } catch (err: any) {
          console.warn(`Wake Lock release failed`);
        }
      }
    };

    if (isLoading) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isLoading) {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      releaseWakeLock();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loading, backgroundLoading]);

  const startLearning = async (
    category: SubCategory, 
    isRandom: boolean, 
    language: Language, 
    studyLength: StudyLength, 
    forceResearch: boolean
  ) => {
    setActiveCategory(category);
    setIsRandomMode(isRandom);
    setActiveLanguage(language);
    setActiveLength(studyLength);
    setForceResearchMode(forceResearch);
    setHasStarted(true);
    setNextContent(null);

    // Something to keep on screen while the new topic is generated:
    // - mid-session (settings changed while reading): keep the current article
    // - fresh launch: the article saved from the previous session
    const keepOnScreen = currentContent ?? cachedContent;
    // The saved launch article is only for the very first start.
    setCachedContent(null);

    if (keepOnScreen) {
      // Generate the freshly-selected topic in the background into
      // nextContent, so it only replaces what's on screen once the user
      // taps "Open Next Topic" — never mid-read.
      // Mark as prefetching so the auto-prefetch effect doesn't start a
      // second, duplicate request for the same slot.
      isPrefetching.current = true;
      if (!currentContent) setCurrentContent(keepOnScreen);
      const myId = ++fetchIdRef.current;
      setBackgroundLoading(true);
      try {
        const content = await generateMedicalTopic(category, isRandom, language, studyLength, forceResearch);
        if (myId === fetchIdRef.current) {
          setNextContent(content);
        }
      } catch (error) {
        console.warn("Initial background generation failed", error);
      } finally {
        isPrefetching.current = false;
        if (myId === fetchIdRef.current) setBackgroundLoading(false);
      }
    } else {
      // No cached article yet (first-ever use) — fall back to the blocking loader.
      await fetchNewTopic(category, isRandom, language, studyLength, forceResearch, true);
    }
  };


  const fetchNewTopic = async (
    category: SubCategory, 
    isRandom: boolean, 
    language: Language, 
    studyLength: StudyLength, 
    forceResearch: boolean,
    forceBlocking: boolean = false
  ) => {
    // 1. If we have PRE-FETCHED content ready, use it immediately.
    if (nextContent && !forceBlocking) {
       console.log("Applying pre-generated content.");
       setCurrentContent(nextContent);
       setNextContent(null);
       window.scrollTo({ top: 0, behavior: 'smooth' });
       return;
    }

    // 2. Decide: Blocking vs Background
    const runInBackground = !forceBlocking && currentContent !== null;
    let myId = 0;

    if (!runInBackground) {
      await runBlocking(
        (onDraft) => generateMedicalTopic(category, isRandom, language, studyLength, forceResearch, onDraft),
        "Failed to load topic. Please check your connection and API key."
      );
      return;
    }

    if (runInBackground) {
        if (backgroundLoading && isPrefetching.current) {
             return; 
        }
        myId = ++fetchIdRef.current;
        setBackgroundLoading(true);
        setNextContent(null);
    } else {
        setLoading(true);
    }

    try {
              // ALWAYS Use the stable model for high-quality content
      const content = await generateMedicalTopic(category, isRandom, language, studyLength, forceResearch);
      
      if (runInBackground) {
        if (myId === fetchIdRef.current) {
             setNextContent(content);
        }
      } else {
        setCurrentContent(content);
      }

    } catch (error) {
      console.error(error);
      alert("Failed to load topic. Please check your connection and API key.");
    } finally {
      if (runInBackground) {
        if (myId === fetchIdRef.current) setBackgroundLoading(false);
      } else {
        setLoading(false);
      }
    }
  };

  const handleKeywordClick = async (keyword: string) => {
    await runBlocking(
      (onDraft) => generateTopicFromKeyword(keyword, activeLanguage, activeLength, onDraft),
      "Failed to load topic from keyword."
    );
  };

  const handleStopGeneration = () => {
    fetchIdRef.current += 1; 
    blockingIdRef.current += 1;
    setDraft(null);
    isPrefetching.current = false;
    setBackgroundLoading(false);
    setLoading(false); 
    console.log("Generation manually stopped by user.");
  };

  const handleChangeLength = async (newLength: StudyLength) => {
    if (!currentContent) return;
    if (newLength === activeLength) return;
    const prev = currentContent;
    setActiveLength(newLength);
    setNextContent(null);
    await runBlocking(
      (onDraft) => rewriteContent(prev.topic, newLength, activeLanguage, onDraft),
      "Failed to rewrite content. Please try again.",
      (c) => keepCardIdentity(prev, c)
    );
  };

  const handleRegenerate = async () => {
    if (!currentContent) return;
    const prev = currentContent;
    await runBlocking(
      (onDraft) => rewriteContent(prev.topic, activeLength, activeLanguage, onDraft),
      "Failed to regenerate content.",
      (c) => keepCardIdentity(prev, c)
    );
  };

  // A rewritten card replaces the same history entry (keeps its id, read date,
  // review progress and series position) instead of adding a new one.
  const keepCardIdentity = (prev: StudyContent, next: StudyContent): StudyContent => {
    const saved = cards.find(c => c.id === prev.id);
    const merged: StudyContent = {
      ...next,
      id: prev.id,
      createdAt: prev.createdAt,
      readAt: saved?.readAt ?? prev.readAt,
      review: saved?.review ?? prev.review,
      specialty: prev.specialty ?? next.specialty,
      seriesId: prev.seriesId,
      seriesIndex: prev.seriesIndex,
      seriesTitle: prev.seriesTitle,
      chat: saved?.chat ?? prev.chat,
    };
    if (prev.id && merged.readAt) {
      const { id, createdAt, readAt, review, chat, ...contentFields } = merged;
      store.updateCard(prev.id, contentFields).catch(e => console.warn('Update failed', e));
    }
    return merged;
  };

  // --- History / review / series actions ---
  const openCard = (card: StudyContent, openChat = false) => {
    setCurrentContent(card);
    setView('study');
    setChatOpen(openChat);
    window.scrollTo({ top: 0 });
  };

  // Saves the conversation on the card (making sure the card is in history first)
  const persistChat = async (card: StudyContent, messages: ChatMessage[]) => {
    if (!card.id) return;
    const now = Date.now();
    await store.saveCardIfNew({
      ...card,
      readAt: card.readAt ?? now,
      review: card.review ?? (card.recall ? initialReview(now) : undefined)
    });
    await store.updateCard(card.id, { chat: messages });
  };

  const handleReviewAnswer = (item: ReviewItem, correct: boolean) => {
    const id = item.card.id;
    if (!id) return;
    if (item.chatAt !== undefined) {
      // a question made from a Q&A answer: update that message inside the card's chat
      const latest = cards.find(c => c.id === id) ?? item.card;
      const chat = (latest.chat || []).map(m =>
        m.at === item.chatAt && m.role === 'assistant' ? { ...m, review: answerReview(m.review, correct) } : m);
      store.updateCard(id, { chat }).catch(e => console.warn('Review update failed', e));
    } else {
      store.updateCard(id, { review: answerReview(item.review, correct) })
        .catch(e => console.warn('Review update failed', e));
    }
  };

  const handleCreateSeries = async (theme: string, partCount: number) => {
    setCreatingSeries(true);
    try {
      const s = await planSeries(theme, partCount, activeLanguage, activeLength);
      await store.saveSeries(s);
    } catch (e) {
      console.error(e);
      alert(labelsFor(activeLanguage).seriesFailed);
    } finally {
      setCreatingSeries(false);
    }
  };

  const openSeriesPart = async (series: Series, index: number) => {
    const existing = cards
      .filter(c => c.seriesId === series.id && c.seriesIndex === index)
      .sort((a, b) => (b.readAt || 0) - (a.readAt || 0))[0];
    if (existing) { openCard(existing); return; }
    const content = await runBlocking(
      (onDraft) => generateSeriesPart(series, index, cards.filter(c => c.seriesId === series.id), onDraft),
      "Failed to write this part. Please try again."
    );
    if (content) {
      store.updateSeries(series.id, {
        parts: series.parts.map((p, i) => i === index ? { ...p, cardId: content.id } : p),
        updatedAt: Date.now()
      }).catch(e => console.warn('Series update failed', e));
    }
  };

  const L = labelsFor(activeLanguage);
  const currentSeries = currentContent?.seriesId ? seriesList.find(x => x.id === currentContent.seriesId) : undefined;
  const savedCurrent = currentContent?.id ? cards.find(c => c.id === currentContent.id) : undefined;
  const currentChat: ChatMessage[] = savedCurrent?.chat ?? currentContent?.chat ?? [];

  return (
    <div className="min-h-screen bg-slate-50 pb-28 relative">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
           <div className="w-8 h-8 bg-blue-600 text-white rounded-md flex items-center justify-center">
              <span className="font-bold text-sm">MD</span>
           </div>
           <span className="font-semibold text-slate-700 hidden sm:block">MedDaily</span>
        </div>
        
        {view === 'study' && (
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            className="text-xs py-2 px-3 h-9"
            onClick={() => setIsSettingsOpen(true)}
            disabled={loading || backgroundLoading}
          >
            <span className="hidden sm:inline mr-1">Current:</span> 
            {isRandomMode ? 'Random' : (activeCategory === SubCategory.OTHER_GENERAL ? 'Other' : activeCategory)}
            <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] uppercase">
               {activeLanguage.substring(0, 2)}
            </span>
          </Button>
          <Button 
            variant="primary"
            className="text-xs py-2 px-3 h-9 flex items-center gap-2"
            onClick={() => hasStarted
              ? fetchNewTopic(activeCategory, isRandomMode, activeLanguage, activeLength, forceResearchMode)
              : setIsSettingsOpen(true)}
            disabled={loading} 
          >
             {nextContent ? "Open Next Topic" : "New Topic"}
          </Button>
        </div>
        )}
        {view !== 'study' && (
          <span className="text-sm font-semibold text-slate-700">
            {view === 'history' ? L.historyTitle : view === 'review' ? L.reviewTitle : L.seriesTitle}
          </span>
        )}
      </header>

      {/* Content Area */}
      <main className="max-w-3xl mx-auto p-4 md:p-8">
        {view === 'history' ? (
          <HistoryView cards={cards} language={activeLanguage} sync={sync} onOpen={openCard}
            onDelete={(id) => store.deleteCard(id).catch(e => alert(String(e)))} />
        ) : view === 'review' ? (
          <ReviewView cards={cards} language={activeLanguage} onAnswer={handleReviewAnswer} onOpenCard={openCard} />
        ) : view === 'series' ? (
          <SeriesView seriesList={seriesList} cards={cards} language={activeLanguage} creating={creatingSeries}
            onCreate={handleCreateSeries} onOpenPart={openSeriesPart}
            onDelete={(id) => store.deleteSeries(id).catch(e => alert(String(e)))} />
        ) : (
        <>
        {dueCount > 0 && !reviewBannerHidden && !loading && (
          <div className="mb-4 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <button onClick={() => setView('review')} className="flex-1 text-left text-sm font-medium text-amber-800">
              {L.reviewBanner(dueCount)} →
            </button>
            <button onClick={() => setReviewBannerHidden(true)} className="text-amber-500 text-lg leading-none px-1">×</button>
          </div>
        )}
        {loading && draft && draft.body ? (
          <article className="bg-white p-6 md:p-10 rounded-2xl shadow-sm border border-slate-100 prose prose-slate prose-blue max-w-none relative">
            <div className="not-prose flex items-center justify-between mb-4">
              <span className="inline-flex items-center gap-2 text-xs font-semibold text-blue-600">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
                {activeLanguage === Language.KOREAN ? '작성 중...' : activeLanguage === Language.JAPANESE ? '作成中...' : 'Writing...'}
              </span>
              <button
                onClick={handleStopGeneration}
                className="px-3 py-1 bg-red-100 text-red-600 text-xs rounded-full hover:bg-red-200 transition-colors font-medium border border-red-200"
              >
                Cancel
              </button>
            </div>
            {draft.title && (
              <h1 className="text-3xl font-extrabold text-slate-900 mb-6 leading-tight">{draft.title}</h1>
            )}
            <div className="text-slate-700 leading-relaxed space-y-4">
              <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                {draft.body}
              </ReactMarkdown>
            </div>
          </article>
        ) : loading ? (
          <div className="relative">
             <Loading 
                message="Consulting guidelines and generating study material..." 
             />
             <div className="absolute top-2 right-2">
               <button 
                  onClick={handleStopGeneration}
                  className="px-3 py-1 bg-red-100 text-red-600 text-xs rounded-full hover:bg-red-200 transition-colors font-medium border border-red-200"
               >
                 Cancel
               </button>
             </div>
          </div>
        ) : currentContent ? (
          <>
            <article className="bg-white p-6 md:p-10 rounded-2xl shadow-sm border border-slate-100 prose prose-slate prose-blue max-w-none relative">
              
              {/* Length Selector & Refresh */}
              <div className="flex flex-wrap justify-end mb-4 items-center gap-2">
                 <button
                    onClick={() => setChatOpen(true)}
                    className="not-prose mr-auto px-3 py-1.5 rounded-full bg-teal-50 text-teal-700 text-xs font-semibold border border-teal-100"
                 >
                   {L.askTitle}{currentChat.length ? ` · ${currentChat.filter(m => m.role === 'user').length}` : ''}
                 </button>
                 
                 <button 
                    onClick={handleRegenerate}
                    disabled={loading || backgroundLoading}
                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-all disabled:opacity-50"
                    title="Regenerate Content (Fix markdown/errors)"
                 >
                   <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                 </button>
                 <div className="inline-flex bg-slate-100 p-1 rounded-lg">
                    {Object.values(StudyLength).map((len) => (
                      <button
                        key={len}
                        onClick={() => handleChangeLength(len)}
                        className={`text-xs px-3 py-1.5 rounded-md font-medium transition-all ${
                          activeLength === len 
                           ? 'bg-white text-blue-700 shadow-sm' 
                           : 'text-slate-500 hover:text-slate-800'
                        }`}
                        disabled={loading || backgroundLoading}
                      >
                        {len}
                      </button>
                    ))}
                 </div>
              </div>

              <div className="flex items-center gap-2 mb-6">
                <span className="px-2 py-1 bg-blue-50 text-blue-700 text-xs font-bold uppercase rounded-md tracking-wider">
                  {currentContent.topic}
                </span>
                <span className="text-slate-400 text-xs">
                  {activeLength}
                </span>
                {/* Visual indicator for Research Mode */}
                {forceResearchMode && (
                   <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] rounded font-bold uppercase">
                     Research Mode
                   </span>
                )}
              </div>
              
              {currentContent.seriesTitle && (
                <button
                  onClick={() => setView('series')}
                  className="not-prose block mb-3 text-xs font-semibold text-violet-700 bg-violet-50 rounded-md px-2 py-1"
                >
                  {L.seriesBadge(currentContent.seriesTitle, (currentContent.seriesIndex ?? 0) + 1, currentSeries?.parts.length ?? 0)}
                </button>
              )}

              <h1 className="text-3xl font-extrabold text-slate-900 mb-6 leading-tight">
                {currentContent.title}
              </h1>

              <div className="text-slate-700 leading-relaxed space-y-4">
                <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                  {currentContent.content}
                </ReactMarkdown>
              </div>

              {currentContent.flowchart && <Flowchart code={currentContent.flowchart} />}

              <button
                onClick={() => setChatOpen(true)}
                className="not-prose mt-8 w-full py-3 px-4 rounded-xl border border-teal-200 bg-teal-50 text-teal-800 text-sm font-semibold text-left"
              >
                {L.askButton}{currentChat.length ? ` · ${L.chatCount(currentChat.filter(m => m.role === 'user').length)}` : ''} →
              </button>

              {currentSeries && typeof currentContent.seriesIndex === 'number' && currentContent.seriesIndex + 1 < currentSeries.parts.length && (
                <button
                  onClick={() => openSeriesPart(currentSeries, (currentContent.seriesIndex as number) + 1)}
                  className="not-prose mt-8 w-full py-3 px-4 rounded-xl bg-violet-600 text-white text-sm font-semibold text-left"
                >
                  {L.seriesNext(currentSeries.parts[(currentContent.seriesIndex as number) + 1].title)} →
                </button>
              )}

              <ImagePanel queries={currentContent.imageQueries || []} language={activeLanguage} />

              <SourceList sources={currentContent.sources} />

              {/* Suggested Topics Section */}
              {currentContent.suggestedTopics && currentContent.suggestedTopics.length > 0 && (
                <div className="mt-8 pt-6 border-t border-slate-200">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                    {activeLanguage === Language.KOREAN ? '심화 학습 키워드 (Related Topics)' : 'Continue Learning'}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {currentContent.suggestedTopics.map((topic, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleKeywordClick(topic)}
                        className={`px-4 py-2 rounded-full text-sm font-medium border shadow-sm transition-all bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white border-blue-100`}
                      >
                        {topic}
                      </button>
                    ))}
                  </div>
                </div>
              )}

            </article>
          </>
        ) : (
          <div className="flex items-center justify-center py-6">
            <div className="max-w-xl w-full text-center">
              <div className="bg-white p-8 rounded-2xl shadow-xl border border-slate-100">
                <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"></path><line x1="12" y1="6" x2="12" y2="18"></line><line x1="6" y1="12" x2="18" y2="12"></line></svg>
                </div>
                <h1 className="text-4xl font-extrabold text-slate-800 mb-2 tracking-tight">MedDaily</h1>
                <p className="text-slate-500 text-lg mb-8">
                  Bite-sized, evidence-based medical learning tailored for busy professionals.
                </p>
                <Button onClick={() => setIsSettingsOpen(true)} fullWidth className="text-lg py-4">
                  Start Learning Session
                </Button>
                <p className="mt-4 text-xs text-slate-400">Powered by Claude. Verified with web search.</p>
              </div>
            </div>
          </div>
        )}
        </>
        )}
      </main>

      {/* Background Status Floating Action Button Area */}

      {/* CASE 1: Loading in Background */}
      {view === 'study' && backgroundLoading && !nextContent && (
        <div className="fixed bottom-24 right-4 z-50 animate-in slide-in-from-bottom-4 fade-in duration-500">
          <div className="group flex items-center gap-3 bg-white/90 backdrop-blur-sm text-slate-800 pl-4 pr-3 py-3 rounded-full shadow-xl border border-blue-200">
            <div className="flex flex-col items-start">
               <span className="text-[10px] uppercase font-bold text-blue-500">AI working...</span>
               <span className="text-sm font-semibold leading-none">Generating Topic</span>
            </div>
            <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center">
               <svg className="animate-spin h-4 w-4 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
               </svg>
            </div>
            {/* Added Stop/Cancel Button for Background Generation */}
            <button 
              onClick={(e) => {
                e.stopPropagation();
                handleStopGeneration();
              }}
              className="ml-2 p-1.5 rounded-full bg-slate-100 hover:bg-red-100 text-slate-400 hover:text-red-500 transition-colors"
              title="Stop Generation"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* CASE 2: Ready */}
      {view === 'study' && nextContent && (
        <div className="fixed bottom-24 right-4 z-50 animate-in slide-in-from-bottom-4 fade-in duration-500">
          <button 
            onClick={() => fetchNewTopic(activeCategory, isRandomMode, activeLanguage, activeLength, forceResearchMode)}
            className="group flex items-center gap-3 bg-slate-900/90 backdrop-blur-sm text-white pl-4 pr-3 py-3 rounded-full shadow-xl hover:bg-blue-600 transition-all border border-slate-700 hover:border-blue-500 hover:scale-105"
          >
            <div className="flex flex-col items-start">
               <span className="text-[10px] uppercase font-bold text-slate-400 group-hover:text-blue-200">Ready</span>
               <span className="text-sm font-semibold leading-none">Open Next Topic</span>
            </div>
            <div className="w-8 h-8 rounded-full bg-slate-700 group-hover:bg-blue-500 flex items-center justify-center transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </div>
          </button>
        </div>
      )}
      
      {chatOpen && currentContent && view === 'study' && (
        <ChatPanel
          key={currentContent.id}
          card={currentContent}
          savedChat={currentChat}
          language={activeLanguage}
          onPersist={(messages) => persistChat(currentContent, messages)}
          onClose={() => setChatOpen(false)}
        />
      )}

      <BottomNav view={view} onChange={(v) => { setView(v); window.scrollTo({ top: 0 }); }} dueCount={dueCount} language={activeLanguage} />

      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)}
        onStart={(...args) => { setView('study'); return startLearning(...args); }}
        initialCategory={activeCategory}
        initialLanguage={activeLanguage}
      />
    </div>
  );
};

export default App;