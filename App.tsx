import React, { useState, useEffect, useRef } from 'react';
import { DEFAULT_CATEGORY } from './constants';
import { SubCategory, StudyContent, Language, StudyLength } from './types';
import { generateMedicalTopic, rewriteContent, generateTopicFromKeyword } from './services/claudeService';
import { Button } from './components/Button';
import { Loading } from './components/Loading';
import { SourceList } from './components/SourceList';
import { SettingsModal } from './components/SettingsModal';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';

const App: React.FC = () => {
  const [hasStarted, setHasStarted] = useState(false);
  
  // Main Loading State (Blocking)
  const [loading, setLoading] = useState(false);
  
  // Background Loading State (Non-blocking)
  const [backgroundLoading, setBackgroundLoading] = useState(false);
  
  const [currentContent, setCurrentContent] = useState<StudyContent | null>(null);
  const [nextContent, setNextContent] = useState<StudyContent | null>(null);
  
  // Ref to track fetch operations and handle race conditions (overrides)
  const fetchIdRef = useRef(0);
  const isPrefetching = useRef(false); // Keeps track if auto-prefetch specifically is running

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

  // Automatically trigger prefetch when currentContent changes
  useEffect(() => {
    if (currentContent && hasStarted) {
      triggerBackgroundPrefetch(activeCategory, isRandomMode, activeLanguage, activeLength, forceResearchMode);
    }
  }, [currentContent, hasStarted, activeCategory, isRandomMode, activeLanguage, activeLength, forceResearchMode]);

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
    
    // Initial load is always blocking
    await fetchNewTopic(category, isRandom, language, studyLength, forceResearch, true);
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
    const runInBackground = currentContent !== null;
    let myId = 0;

    if (runInBackground) {
        myId = ++fetchIdRef.current;
        setBackgroundLoading(true);
        setNextContent(null); 
        
        try {
             const content = await generateTopicFromKeyword(keyword, activeLanguage, activeLength);
             if (myId === fetchIdRef.current) {
                 setNextContent(content);
             }
        } catch (error) {
             console.error(error);
             alert("Failed to load topic from keyword.");
        } finally {
             if (myId === fetchIdRef.current) {
                 setBackgroundLoading(false);
             }
        }
    } else {
        setLoading(true);
        try {
          const content = await generateTopicFromKeyword(keyword, activeLanguage, activeLength);
          setCurrentContent(content);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (error) {
          console.error(error);
          alert("Failed to load topic from keyword.");
        } finally {
          setLoading(false);
        }
    }
  };

  const handleStopGeneration = () => {
    fetchIdRef.current += 1; 
    isPrefetching.current = false;
    setBackgroundLoading(false);
    setLoading(false); 
    console.log("Generation manually stopped by user.");
  };

  const handleChangeLength = async (newLength: StudyLength) => {
    if (!currentContent) return;
    if (newLength === activeLength) return;

    setLoading(true);
    setActiveLength(newLength);
    setNextContent(null); 

    try {
      // Basic rewrite uses Flash by default
      const newContent = await rewriteContent(currentContent.topic, newLength, activeLanguage);
      setCurrentContent(newContent);
    } catch (error) {
      console.error(error);
      alert("Failed to rewrite content. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerate = async () => {
    if (!currentContent) return;
    setLoading(true);

    try {
      const newContent = await rewriteContent(currentContent.topic, activeLength, activeLanguage);
      setCurrentContent(newContent);
    } catch (error) {
      console.error(error);
      alert("Failed to regenerate content.");
    } finally {
      setLoading(false);
    }
  };

  if (!hasStarted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-slate-100 flex items-center justify-center p-4">
        <div className="max-w-xl w-full text-center space-y-8">
          <div className="bg-white p-8 rounded-2xl shadow-xl border border-slate-100">
            <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.8 2.3A.3.3 0 0 1 5 2h14a.3.3 0 0 1 .2.3v17a.3.3 0 0 1-.2.3H5a.3.3 0 0 1-.2-.3V2.3z"></path><path d="M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"></path><line x1="12" y1="6" x2="12" y2="18"></line><line x1="6" y1="12" x2="18" y2="12"></line></svg>
            </div>
            <h1 className="text-4xl font-extrabold text-slate-800 mb-2 tracking-tight">MedDaily</h1>
            <p className="text-slate-500 text-lg mb-8">
              Bite-sized, evidence-based medical learning tailored for busy professionals.
              Focus on Internal Medicine, Cardiology, and more.
            </p>
            <div className="bg-blue-50 p-4 rounded-lg text-sm text-blue-800 mb-6">
               <p>Supports Korean, English, and Japanese.</p>
            </div>
            <Button 
              onClick={() => setIsSettingsOpen(true)} 
              fullWidth
              className="text-lg py-4"
            >
              Start Learning Session
            </Button>
            <p className="mt-4 text-xs text-slate-400">
              Powered by Claude. Verified with web search.
            </p>
          </div>
        </div>
        <SettingsModal 
          isOpen={isSettingsOpen} 
          onClose={() => setIsSettingsOpen(false)}
          onStart={startLearning}
          initialCategory={activeCategory}
          initialLanguage={activeLanguage}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20 relative">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
           <div className="w-8 h-8 bg-blue-600 text-white rounded-md flex items-center justify-center">
              <span className="font-bold text-sm">MD</span>
           </div>
           <span className="font-semibold text-slate-700 hidden sm:block">MedDaily</span>
        </div>
        
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
            onClick={() => fetchNewTopic(activeCategory, isRandomMode, activeLanguage, activeLength, forceResearchMode)}
            disabled={loading} 
          >
             {nextContent ? "Open Next Topic" : "New Topic"}
          </Button>
        </div>
      </header>

      {/* Content Area */}
      <main className="max-w-3xl mx-auto p-4 md:p-8">
        {loading ? (
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
              
              <h1 className="text-3xl font-extrabold text-slate-900 mb-6 leading-tight">
                {currentContent.title}
              </h1>

              <div className="text-slate-700 leading-relaxed space-y-4">
                <ReactMarkdown 
                  remarkPlugins={[remarkMath, remarkGfm]}
                  rehypePlugins={[rehypeKatex]}
                  components={{
                     h1: ({node, ...props}) => <h2 className="text-2xl font-bold text-slate-800 mt-8 mb-4" {...props} />,
                     h2: ({node, ...props}) => <h3 className="text-xl font-semibold text-slate-800 mt-6 mb-3" {...props} />,
                     h3: ({node, ...props}) => <h4 className="text-lg font-medium text-slate-800 mt-4 mb-2" {...props} />,
                     p: ({node, ...props}) => <p className="mb-4 text-lg" {...props} />,
                     ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-4 space-y-2" {...props} />,
                     li: ({node, ...props}) => <li className="pl-1" {...props} />,
                     strong: ({node, ...props}) => <strong className="font-semibold text-slate-900" {...props} />,
                     blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-blue-500 pl-4 py-1 italic bg-slate-50 text-slate-600 rounded-r-lg my-6" {...props} />,
                     table: ({node, ...props}) => <div className="overflow-x-auto mb-6"><table className="min-w-full border-collapse border border-slate-200" {...props} /></div>,
                     thead: ({node, ...props}) => <thead className="bg-slate-50" {...props} />,
                     th: ({node, ...props}) => <th className="border border-slate-200 px-4 py-2 text-left font-semibold text-slate-700 text-sm whitespace-nowrap" {...props} />,
                     td: ({node, ...props}) => <td className="border border-slate-200 px-4 py-2 text-sm text-slate-600" {...props} />,
                  }}
                >
                  {currentContent.content}
                </ReactMarkdown>
              </div>

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
          <div className="text-center py-20">
             <p className="text-slate-500">Ready to start? Select a topic or choose random mode.</p>
          </div>
        )}
      </main>

      {/* Background Status Floating Action Button Area */}
      
      {/* CASE 1: Loading in Background */}
      {backgroundLoading && !nextContent && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-4 fade-in duration-500">
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
      {nextContent && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-4 fade-in duration-500">
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
      
      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)}
        onStart={startLearning}
        initialCategory={activeCategory}
        initialLanguage={activeLanguage}
      />
    </div>
  );
};

export default App;