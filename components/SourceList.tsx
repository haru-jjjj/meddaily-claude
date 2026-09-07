import React from 'react';
import { Source } from '../types';

interface SourceListProps {
  sources: Source[];
}

export const SourceList: React.FC<SourceListProps> = ({ sources }) => {
  if (sources.length === 0) return null;

  return (
    <div className="mt-6 pt-4 border-t border-slate-200">
      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
        Sources
      </h3>
      <div className="flex flex-wrap gap-2">
        {sources.map((source, idx) => {
          // Provide fallback title if empty or just whitespace
          let displayTitle = source.title && source.title.trim() !== '' ? source.title.trim() : null;
          
          // Try to extract hostname if title is missing
          if (!displayTitle) {
             try {
               displayTitle = new URL(source.uri).hostname;
             } catch (e) {
               displayTitle = 'Source Link';
             }
          }

          return (
            <a 
              key={idx}
              href={source.uri} 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white hover:bg-blue-50 text-slate-600 hover:text-blue-700 border border-slate-200 hover:border-blue-300 transition-all text-xs font-medium no-underline shadow-sm hover:shadow-md"
              title={source.uri}
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0 opacity-60" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
              </svg>
              <span className="truncate max-w-[240px]">{displayTitle}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
};