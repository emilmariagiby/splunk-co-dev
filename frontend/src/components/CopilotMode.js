import { useState } from "react";

// ── Typing cursor ─────────────────────────────────────────────────────────────
function TypingCursor() {
  return <span className="inline-block w-0.5 h-4 bg-splunk-green animate-pulse ml-0.5 align-middle" />;
}

// ── Streaming text block ──────────────────────────────────────────────────────
// Shows text as it arrives token by token; once done, renders the structured view.
function StreamingView({ streamText, isStreaming }) {
  if (!streamText && !isStreaming) return null;
  return (
    <div className="bg-[#0a0a0a] border border-splunk-green/20 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full bg-splunk-green animate-pulse" />
        <span className="text-splunk-green text-xs font-semibold uppercase tracking-wide">
          {isStreaming ? 'Thinking...' : 'Complete'}
        </span>
      </div>
      <p className="text-gray-300 text-sm font-mono leading-relaxed whitespace-pre-wrap break-words">
        {streamText || ''}
        {isStreaming && <TypingCursor />}
      </p>
    </div>
  );
}

// ── Main CopilotMode component ────────────────────────────────────────────────
function CopilotMode({ suggestion, streamText, isStreaming, setInputValue, loading }) {
  const [copied, setCopied] = useState(null);
  const handleCopy = (text, label) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const showStream = isStreaming || (streamText && !suggestion);
  const showResult = suggestion && !isStreaming;

  return (
    <div className="space-y-6">

      {/* Empty state */}
      {!suggestion && !loading && !isStreaming && !streamText && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Co&gt;Dev Copilot</h2>
          <p className="text-gray-400 text-sm">
            Your AI companion that knows your codebase, session history, and suggests exactly what to do next.
            Connect a workspace in the sidebar to unlock codebase-aware answers.
          </p>

          <div className="space-y-3 mt-8">
            <p className="text-gray-500 text-xs uppercase tracking-wide font-semibold">Try a question</p>
            <div className="flex flex-wrap gap-2">
              {[
                "What should I build next?",
                "What patterns do you see in my queries?",
                "How do I optimize my most expensive query?",
                "What Splunk dashboards should I create?",
                "Review my codebase for logging issues",
              ].map((q, i) => (
                <button
                  key={i}
                  onClick={() => setInputValue(q)}
                  className="text-xs bg-white/5 hover:bg-splunk-green/10 border border-white/10 hover:border-splunk-green/30 text-gray-300 hover:text-splunk-green px-3 py-2 rounded-full transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Streaming live view */}
      {showStream && (
        <StreamingView streamText={streamText} isStreaming={isStreaming} />
      )}

      {/* Structured result — shown once streaming is done */}
      {showResult && (
        <div className="space-y-6">

          {/* Summary */}
          <div className="bg-[#0a0a0a] border border-splunk-green/30 rounded-xl p-5 shadow-[0_0_20px_rgba(101,194,113,0.05)]">
            <h3 className="flex items-center gap-2 text-splunk-green text-sm font-semibold mb-2 uppercase tracking-wide">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                  d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
              What You're Building
            </h3>
            <p className="text-gray-300 text-sm leading-relaxed">{suggestion.summary}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Next steps */}
            <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-5">
              <h3 className="flex items-center gap-2 text-gray-300 text-sm font-semibold mb-4 uppercase tracking-wide">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
                Next Steps
              </h3>
              <div className="space-y-3">
                {suggestion.next_steps?.map((step, i) => (
                  <div key={i} className="flex gap-3">
                    <span className="text-splunk-green font-bold text-sm bg-splunk-green/10 w-6 h-6 flex items-center justify-center rounded-full shrink-0 mt-0.5">{i + 1}</span>
                    <p className="text-gray-300 text-sm leading-relaxed">{step}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Insights */}
            <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-5">
              <h3 className="flex items-center gap-2 text-gray-300 text-sm font-semibold mb-4 uppercase tracking-wide">
                <svg className="w-4 h-4 text-splunk-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Insights
              </h3>
              <p className="text-gray-300 text-sm leading-relaxed">{suggestion.insights}</p>
            </div>
          </div>

          {/* Suggested queries */}
          <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-5">
            <h3 className="flex items-center gap-2 text-gray-300 text-sm font-semibold mb-4 uppercase tracking-wide">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              Suggested Queries
            </h3>
            <div className="space-y-3">
              {suggestion.suggested_queries?.map((sq, i) => (
                <div key={i} className="bg-black/20 border border-white/5 rounded-lg p-4">
                  <p className="text-gray-400 text-xs mb-3 italic">{sq.description}</p>
                  <div className="flex items-center justify-between gap-4">
                    <code className="text-splunk-green text-sm font-mono break-all">{sq.spl}</code>
                    <button
                      onClick={() => handleCopy(sq.spl, `query-${i}`)}
                      className="text-xs bg-white/5 hover:bg-white/10 text-gray-300 px-3 py-1.5 rounded transition-colors border border-white/10 shrink-0"
                    >
                      {copied === `query-${i}` ? '✓ Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

    </div>
  );
}

export default CopilotMode;
