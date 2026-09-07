import React, { useEffect, useState } from 'react';

interface LoadingProps {
  message: string;
}

export const Loading: React.FC<LoadingProps> = ({ message }) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const now = Date.now();
      const diff = Math.floor((now - startTime) / 1000);
      setElapsedSeconds(diff);
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center p-12 text-center w-full max-w-md mx-auto animate-in fade-in duration-700">
      <div className="w-16 h-16 mb-6 text-blue-500 animate-spin">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      </div>

      <h3 className="text-lg font-bold text-slate-800 mb-2">{message}</h3>
      <p className="text-sm text-slate-500 font-mono bg-slate-100 px-3 py-1 rounded-full">
        Time Elapsed: {elapsedSeconds}s
      </p>

      <div className="mt-8 flex gap-2 justify-center">
        <div className="w-2 h-2 rounded-full bg-slate-300 animate-bounce delay-0"></div>
        <div className="w-2 h-2 rounded-full bg-slate-300 animate-bounce delay-150"></div>
        <div className="w-2 h-2 rounded-full bg-slate-300 animate-bounce delay-300"></div>
      </div>
    </div>
  );
};
