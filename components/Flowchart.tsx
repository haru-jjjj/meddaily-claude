import React, { useEffect, useState } from 'react';

// Mermaid is loaded from a CDN only when a card actually has a flowchart,
// so it adds nothing to the app's bundle or initial load time.
const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';

let mermaidPromise: Promise<any> | null = null;
function loadMermaid(): Promise<any> {
  if (!mermaidPromise) {
    mermaidPromise = import(/* @vite-ignore */ MERMAID_URL).then((mod: any) => {
      const mermaid = mod.default || mod;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'neutral',
        flowchart: { useMaxWidth: true, htmlLabels: true }
      });
      return mermaid;
    }).catch((e: unknown) => {
      mermaidPromise = null; // allow retry next time
      throw e;
    });
  }
  return mermaidPromise;
}

let renderCount = 0;

interface FlowchartProps {
  code: string;
}

export const Flowchart: React.FC<FlowchartProps> = ({ code }) => {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setFailed(false);
    loadMermaid()
      .then(async (mermaid) => {
        const id = `meddaily-flow-${++renderCount}`;
        const result = await mermaid.render(id, code);
        if (!cancelled) setSvg(result.svg);
      })
      .catch((e: unknown) => {
        console.warn('Flowchart render failed', e);
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
  }, [code]);

  // A malformed diagram is simply hidden rather than showing an error.
  if (failed) return null;

  return (
    <div className="not-prose my-8 rounded-xl border border-slate-200 bg-slate-50 p-3 overflow-x-auto">
      {svg ? (
        <div className="flex justify-center min-w-[280px]" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="h-24 flex items-center justify-center text-xs text-slate-400">…</div>
      )}
    </div>
  );
};
