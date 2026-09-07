import React, { useState } from 'react';
import { CategoryType, SubCategory, Language, StudyLength } from '../types';
import { CATEGORY_MAP } from '../constants';
import { Button } from './Button';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStart: (category: SubCategory, isRandom: boolean, language: Language, studyLength: StudyLength, forceResearchMode: boolean) => void;
  initialCategory: SubCategory;
  initialLanguage: Language;
}

type SelectionMode = 'random' | 'internal' | 'other' | 'statistics' | 'pharmacology';

export const SettingsModal: React.FC<SettingsModalProps> = ({ 
  isOpen, 
  onClose, 
  onStart,
  initialCategory,
  initialLanguage
}) => {
  // Determine initial mode based on category
  const getInitialMode = (): SelectionMode => {
    if (initialCategory === SubCategory.RANDOM) return 'random';
    if (initialCategory === SubCategory.MEDICAL_STATISTICS) return 'statistics';
    if (initialCategory === SubCategory.PHARMACOLOGY) return 'pharmacology';
    if (CATEGORY_MAP[CategoryType.INTERNAL_MEDICINE].includes(initialCategory)) return 'internal';
    return 'other';
  };

  const [mode, setMode] = useState<SelectionMode>(getInitialMode());
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(initialLanguage);
  const [forceResearchMode, setForceResearchMode] = useState<boolean>(false);
  const [selectedLength, setSelectedLength] = useState<StudyLength>(StudyLength.MEDIUM);
  
  // Selections for specific modes
  const [internalSelection, setInternalSelection] = useState<SubCategory>(
    CATEGORY_MAP[CategoryType.INTERNAL_MEDICINE].includes(initialCategory) ? initialCategory : SubCategory.INTERNAL_MEDICINE_GENERAL
  );
  const [otherSelection, setOtherSelection] = useState<SubCategory>(
    CATEGORY_MAP[CategoryType.OTHER].includes(initialCategory) ? initialCategory : SubCategory.OTHER_GENERAL
  );

  if (!isOpen) return null;

  const handleStart = () => {
    if (mode === 'random') {
      // Global Random
      onStart(SubCategory.RANDOM, true, selectedLanguage, selectedLength, forceResearchMode);
    } else if (mode === 'statistics') {
      // Medical Statistics & EBM
      onStart(SubCategory.MEDICAL_STATISTICS, false, selectedLanguage, selectedLength, forceResearchMode);
    } else if (mode === 'pharmacology') {
      // Clinical Pharmacology
      onStart(SubCategory.PHARMACOLOGY, false, selectedLanguage, selectedLength, forceResearchMode);
    } else if (mode === 'internal') {
       // Keep "All Internal Medicine" as a generic selection instead of picking a random one once
       onStart(internalSelection, false, selectedLanguage, selectedLength, forceResearchMode);
    } else {
      // Other Specialties
      onStart(otherSelection, false, selectedLanguage, selectedLength, forceResearchMode);
    }
    onClose();
  };

  const ModeCard = ({ 
    active, 
    onClick, 
    title, 
    description,
    children 
  }: { 
    active: boolean; 
    onClick: () => void; 
    title: string; 
    description: string;
    children?: React.ReactNode;
  }) => (
    <div 
      onClick={onClick}
      className={`relative p-4 rounded-xl border-2 transition-all cursor-pointer ${
        active 
          ? 'border-blue-600 bg-blue-50/50 ring-1 ring-blue-600/20' 
          : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
      }`}
    >
      <div className="flex items-start gap-4">
        {/* Radio Indicator */}
        <div className={`mt-1 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
          active ? 'border-blue-600 bg-blue-600' : 'border-slate-300'
        }`}>
          {active && <div className="w-2 h-2 rounded-full bg-white" />}
        </div>
        
        <div className="flex-1">
          <h3 className={`font-bold text-sm ${active ? 'text-blue-900' : 'text-slate-700'}`}>{title}</h3>
          <p className="text-xs text-slate-500 mt-1 mb-2">{description}</p>
          
          {/* Render children (dropdowns) only if active to reduce clutter, or keep mounted but hidden/disabled if preferred. 
              Here we render them only when active for cleaner UI. */}
          {active && children && (
            <div className="mt-3 animate-in slide-in-from-top-2 fade-in duration-200" onClick={(e) => e.stopPropagation()}>
              {children}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-6 bg-slate-50 border-b border-slate-100">
          <h2 className="text-xl font-bold text-slate-800">Study Configuration</h2>
          <p className="text-sm text-slate-500">Choose your topic and preferred language.</p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* Language Selection */}
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Language</label>
            <div className="grid grid-cols-3 gap-2">
              {Object.values(Language).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setSelectedLanguage(lang)}
                  className={`py-2 px-3 text-sm font-medium rounded-md border transition-all ${
                    selectedLanguage === lang 
                      ? 'bg-blue-600 text-white border-blue-600 shadow-sm' 
                      : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                  }`}
                >
                  {lang === Language.KOREAN ? '한국어' : lang}
                </button>
              ))}
            </div>
          </div>

          {/* Study Length Selection */}
          <div className="pt-2">
             <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Study Length</label>
             <div className="grid grid-cols-3 gap-2">
                {Object.values(StudyLength).map((len) => (
                   <button
                     key={len}
                     onClick={() => setSelectedLength(len)}
                     className={`py-2 px-2 text-[11px] font-medium rounded-md border transition-all whitespace-nowrap ${
                       selectedLength === len
                         ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                         : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                     }`}
                   >
                     {len}
                   </button>
                ))}
             </div>
          </div>

          <hr className="border-slate-100" />

           {/* Research Mode Checkbox */}
           <div 
            onClick={() => setForceResearchMode(!forceResearchMode)}
            className={`p-3 rounded-lg border cursor-pointer transition-colors flex items-center gap-3 ${
              forceResearchMode ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200 hover:bg-slate-50'
            }`}
          >
             <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
               forceResearchMode ? 'bg-amber-500 border-amber-500' : 'bg-white border-slate-300'
             }`}>
                {forceResearchMode && <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
             </div>
             <div>
               <h3 className="text-sm font-bold text-slate-800">
                  {selectedLanguage === Language.KOREAN ? "최신 논문/임상시험 리뷰 모드" : "Research Papers & Trials Mode"}
               </h3>
               <p className="text-xs text-slate-500">
                 {selectedLanguage === Language.KOREAN 
                  ? "다음 주제로 2020-2025년 주요 임상 연구 리뷰를 강제로 선택합니다."
                  : "Force the next topic to be a review of a recent high-impact clinical trial."}
               </p>
              </div>
          </div>
          
          <hr className="border-slate-100" />

          {/* Mode Selection */}
          <div className="space-y-3">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide">Topic Selection</label>
            
            {/* 1. Global Random */}
            <ModeCard 
              active={mode === 'random'}
              onClick={() => setMode('random')}
              title="Surprise Me (Random)"
              description="Completely random medical topic from any field."
            />

            {/* 2. Internal Medicine */}
            <ModeCard 
              active={mode === 'internal'}
              onClick={() => setMode('internal')}
              title="Internal Medicine (내과)"
              description="Focus on internal medicine subspecialties."
            >
               <select 
                value={internalSelection}
                onChange={(e) => setInternalSelection(e.target.value as SubCategory)}
                className="w-full p-2.5 bg-white border border-slate-300 rounded-md text-slate-700 focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
              >
                <option value={SubCategory.INTERNAL_MEDICINE_GENERAL}>✨ 내과 전체 (랜덤 선택) / All Internal Medicine</option>
                <hr />
                {CATEGORY_MAP[CategoryType.INTERNAL_MEDICINE]
                  .filter(sub => sub !== SubCategory.INTERNAL_MEDICINE_GENERAL)
                  .map(sub => (
                  <option key={sub} value={sub}>{sub}</option>
                ))}
              </select>
            </ModeCard>

            {/* 3. Other Specialties */}
            <ModeCard 
              active={mode === 'other'}
              onClick={() => setMode('other')}
              title="Other Specialties (그 외 과목)"
              description="Surgery, Pediatrics, OBGYN, etc."
            >
              <select 
                value={otherSelection}
                onChange={(e) => setOtherSelection(e.target.value as SubCategory)}
                className="w-full p-2.5 bg-white border border-slate-300 rounded-md text-slate-700 focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
              >
                {CATEGORY_MAP[CategoryType.OTHER].map(sub => (
                  <option key={sub} value={sub}>
                    {sub === SubCategory.OTHER_GENERAL ? "Any Other Specialty (Mixed)" : sub}
                  </option>
                ))}
              </select>
            </ModeCard>

            {/* 4. Pharmacology */}
            <ModeCard 
              active={mode === 'pharmacology'}
              onClick={() => setMode('pharmacology')}
              title="Clinical Pharmacology"
              description="Random drug analysis: Mechanism, Dosage, Indications."
            />

            {/* 5. Statistics */}
            <ModeCard 
              active={mode === 'statistics'}
              onClick={() => setMode('statistics')}
              title="Medical Statistics & EBM"
              description="How to read papers, P-values, Study Designs."
            />
          </div>

        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} className="border-0">Cancel</Button>
          <Button onClick={handleStart}>
            Start Learning
          </Button>
        </div>
      </div>
    </div>
  );
};