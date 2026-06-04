import { useState, useEffect, useRef, useCallback } from "react";
import QueryMode from "./components/QueryMode";
import OnboardMode from "./components/OnboardMode";
import CopilotMode from "./components/CopilotMode";
import ErrorBoundary from "./components/ErrorBoundary";

function App() {
  // Global active mode
  const [activeMode, setActiveMode] = useState("copilot"); // 'query', 'onboard', 'copilot'
  
  // Unified Input
  const [inputValue, setInputValue] = useState("");
  
  // Global Loading State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Results for each mode
  const [queryResult, setQueryResult] = useState(null);
  const [onboardResult, setOnboardResult] = useState(null);
  const [copilotResult, setCopilotResult] = useState(null);

  // Copilot streaming state
  const [copilotStreamText, setCopilotStreamText] = useState("");
  const [copilotStreaming, setCopilotStreaming] = useState(false);

  // Global Session History
  const [session, setSession] = useState(null);
  const textareaRef = useRef(null);
  // Tracks whether the next query submission should override CRITICAL block
  const overrideCriticalRef = useRef(false);

  // Workspace context
  const [workspace, setWorkspace] = useState(null);
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState(null);

  // Fetch session on load
  useEffect(() => {
    fetchSession();
    fetchWorkspace();
  }, []);

  const fetchSession = async () => {
    try {
      const response = await fetch("http://localhost:3002/api/copilot/session");
      const data = await response.json();
      setSession(data);
    } catch {
      // ignore
    }
  };

  const fetchWorkspace = async () => {
    try {
      const res = await fetch("http://localhost:3002/api/workspace/context");
      const data = await res.json();
      if (data.connected) setWorkspace(data.workspace);
      else setWorkspace(null);
    } catch { }
  };

  const handleConnectWorkspace = async () => {
    if (!workspacePath.trim()) return;
    setWorkspaceLoading(true);
    setWorkspaceError(null);
    try {
      const res = await fetch("http://localhost:3002/api/workspace/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderPath: workspacePath.trim() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await fetchWorkspace();
      setWorkspacePath("");
    } catch (err) {
      setWorkspaceError(err.message || "Failed to scan workspace");
    } finally {
      setWorkspaceLoading(false);
    }
  };

  const handleDisconnectWorkspace = async () => {
    try {
      await fetch("http://localhost:3002/api/workspace/disconnect", { method: "DELETE" });
      setWorkspace(null);
    } catch { }
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + "px";
    }
  }, [inputValue]);

  // Listen for override signal fired from QueryMode's "Override" button
  useEffect(() => {
    const handler = () => {
      overrideCriticalRef.current = true;
      handleSubmit();
    };
    window.addEventListener('codev:overrideCritical', handler);
    return () => window.removeEventListener('codev:overrideCritical', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValue]);

  const handleSubmit = async () => {
    if (!inputValue.trim() || loading) return;

    setLoading(true);
    setError(null);

    const input = inputValue;
    // Don't clear input here so the user can edit their query if it failed, unless it's a copilot chat.
    // For copilot chat, we'll clear it after success.

    try {
      if (activeMode === "query") {
        setQueryResult(null);
        const isOverride = overrideCriticalRef.current;
        overrideCriticalRef.current = false; // reset after consuming
        const res = await fetch("http://localhost:3002/api/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: input, overrideCritical: isOverride }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setQueryResult(data);
        // Only track to copilot if query wasn't blocked
        if (!data.blocked) await trackToCopilot('query', data);
      } 
      else if (activeMode === "onboard") {
        setOnboardResult(null);
        const res = await fetch("http://localhost:3002/api/onboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ logSample: input }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setOnboardResult(data);
        await trackToCopilot('log', data);
      } 
      else if (activeMode === "copilot") {
        setCopilotResult(null);
        setCopilotStreamText("");
        setCopilotStreaming(true);
        setInputValue(""); // Clear input immediately for chat feel

        try {
          const res = await fetch("http://localhost:3002/api/copilot/suggest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: input }),
          });

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let currentEvent = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith("event:")) {
                currentEvent = trimmed.slice(6).trim();
                continue;
              }
              if (!trimmed.startsWith("data:")) continue;
              const payload = trimmed.slice(5).trim();
              try {
                const evt = JSON.parse(payload);
                if (currentEvent === "token") {
                  setCopilotStreamText(prev => prev + (evt.token ?? ""));
                } else if (currentEvent === "done") {
                  setCopilotResult(evt);
                  setCopilotStreaming(false);
                } else if (currentEvent === "error") {
                  throw new Error(evt.error || "Copilot stream error");
                }
              } catch { /* ignore malformed lines */ }
              currentEvent = "";
            }
          }
        } finally {
          setCopilotStreaming(false);
        }
      }
    } catch (err) {
      setError(err.message || "An error occurred.");
    } finally {
      setLoading(false);
      fetchSession(); // Refresh sidebar
    }
  };

  const trackToCopilot = async (type, data) => {
    try {
      await fetch("http://localhost:3002/api/copilot/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, data }),
      });
    } catch { }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const placeholders = {
    query: "Paste your SPL query to debug and optimize...",
    onboard: "Paste a raw log sample to generate configurations...",
    copilot: "Ask anything... e.g. What should I build next?",
  };

  const handleAppMouseMove = (e) => {
    e.currentTarget.style.setProperty('--mouse-x', `${e.clientX}px`);
    e.currentTarget.style.setProperty('--mouse-y', `${e.clientY}px`);
  };

  return (
    <div 
      className="flex h-screen overflow-hidden bg-splunk-dark text-gray-200 relative group"
      onMouseMove={handleAppMouseMove}
    >
      {/* Interactive mouse-following spotlight */}
      <div 
        className="pointer-events-none absolute inset-0 z-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{
          background: `radial-gradient(800px circle at var(--mouse-x, 50%) var(--mouse-y, 50%), rgba(101,194,113,0.06), transparent 40%)`
        }}
      />
      
      {/* Dynamic Animated Background Blobs (very faint for stark premium look) */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[70vw] h-[70vw] rounded-full bg-splunk-green/[0.02] blur-[120px] mix-blend-screen animate-blob"></div>
        <div className="absolute top-[20%] -right-[20%] w-[60vw] h-[60vw] rounded-full bg-splunk-green/[0.015] blur-[100px] mix-blend-screen animate-blob animation-delay-2000"></div>
        <div className="absolute -bottom-[20%] left-[20%] w-[80vw] h-[80vw] rounded-full bg-splunk-green/[0.02] blur-[150px] mix-blend-screen animate-blob animation-delay-4000"></div>
      </div>

      {/* Sidebar: Session History */}
      <div className="w-64 flex-shrink-0 bg-[#050505] border-r border-[#1a1a1a] flex flex-col z-10 relative shadow-[10px_0_30px_rgba(0,0,0,0.5)]">
        <div className="p-6 pb-2 border-b border-transparent">
          <h1 className="text-xl font-mono text-white flex flex-col tracking-tight">
            <span className="text-splunk-green font-bold text-sm">splunk&gt;</span>
            <span className="text-2xl font-light">codev<span className="text-splunk-green">_</span></span>
          </h1>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-6">

          {/* ── Workspace connector ── */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Workspace</h3>
            {workspace ? (
              <div className="space-y-2">
                <div className="bg-splunk-green/10 border border-splunk-green/30 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-splunk-green animate-pulse"></div>
                    <span className="text-splunk-green text-xs font-semibold truncate">{workspace.folderName}</span>
                  </div>
                  <p className="text-gray-500 text-[10px]">
                    {workspace.totalFiles} files · {workspace.totalLogLines} log lines
                  </p>
                </div>
                <button
                  onClick={handleDisconnectWorkspace}
                  className="w-full text-[10px] text-gray-600 hover:text-gray-400 transition-colors py-1"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  type="text"
                  value={workspacePath}
                  onChange={e => setWorkspacePath(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleConnectWorkspace()}
                  placeholder="Paste folder path..."
                  className="w-full bg-[#0a0a0a] border border-[#1a1a1a] focus:border-splunk-green/50 text-white text-xs px-3 py-2 rounded-lg outline-none transition-colors placeholder-gray-600"
                />
                {workspaceError && (
                  <p className="text-red-400 text-[10px] leading-tight">{workspaceError}</p>
                )}
                <button
                  onClick={handleConnectWorkspace}
                  disabled={workspaceLoading || !workspacePath.trim()}
                  className="w-full bg-[#0a0a0a] hover:bg-splunk-green/10 border border-[#1a1a1a] hover:border-splunk-green/40 text-gray-400 hover:text-splunk-green text-xs py-2 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                >
                  {workspaceLoading ? (
                    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  ) : (
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path></svg>
                  )}
                  {workspaceLoading ? 'Scanning...' : 'Connect Workspace'}
                </button>
              </div>
            )}
          </div>

          {/* ── Session history ── */}
          {session && (session.queries?.length > 0 || session.logs?.length > 0) ? (
            <>
              {session.queries?.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Recent Queries</h3>
                  <div className="space-y-2">
                    {session.queries.slice(-5).reverse().map((q, i) => (
                      <div key={i} className="text-xs text-gray-300 truncate bg-[#0a0a0a] p-3 rounded border border-[#1a1a1a] hover:border-[#333] transition-colors cursor-pointer">
                        {q.fixed}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {session.logs?.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Recent Logs</h3>
                  <div className="space-y-2">
                    {session.logs.slice(-5).reverse().map((l, i) => (
                      <div key={i} className="text-xs text-gray-300 truncate bg-[#0a0a0a] p-3 rounded border border-[#1a1a1a] hover:border-[#333] transition-colors cursor-pointer">
                        {l.sourcetype}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-gray-500">No session history yet.</p>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col z-10 relative">
        
        {/* Scrollable Results Area */}
        <div className="flex-1 overflow-y-auto p-6 lg:p-10 scroll-smooth">
          <div className="max-w-4xl mx-auto w-full pb-[400px]">
            {/* Render the Active Mode Component */}
            {/* We pass down the results and setInputValue so components can still trigger samples */}
            <div className={`transition-opacity duration-500 ${loading ? 'opacity-50' : 'opacity-100'}`}>
              <ErrorBoundary>
                {activeMode === "query" && (
                  <QueryMode 
                    result={queryResult} 
                    setInputValue={setInputValue}
                    loading={loading}
                  />
                )}
                {activeMode === "onboard" && (
                  <OnboardMode 
                    result={onboardResult} 
                    setInputValue={setInputValue}
                    loading={loading}
                  />
                )}
                {activeMode === "copilot" && (
                  <CopilotMode 
                    suggestion={copilotResult} 
                    streamText={copilotStreamText}
                    isStreaming={copilotStreaming}
                    setInputValue={setInputValue}
                    loading={loading}
                  />
                )}
              </ErrorBoundary>
              
              {!loading && !copilotStreaming && !queryResult && !onboardResult && !copilotResult && !copilotStreamText && (
                <div className="flex flex-col items-center justify-center h-[50vh] text-center">
                  <h2 className="text-3xl font-light text-white mb-3">Ready when you are.</h2>
                  <p className="text-gray-400 text-sm max-w-md">
                    Select a mode below and enter your Splunk SPL, raw logs, or questions to get started.
                  </p>
                </div>
              )}
              
              {error && (
                <div className="mt-4 bg-red-900/50 backdrop-blur-sm border border-red-500/50 text-red-200 p-4 rounded-lg">
                  {error}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Unified Prompt Bar */}
        <div className="absolute bottom-0 w-full bg-gradient-to-t from-splunk-dark via-splunk-dark/95 to-transparent pt-10 pb-6 px-6 z-20">
          <div className="max-w-4xl mx-auto w-full flex flex-col items-center gap-3">

            {/* The Input Box */}
            <div className="relative w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded-[32px] p-3 shadow-2xl transition-all duration-300 focus-within:border-splunk-green/50">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholders[activeMode]}
                className="w-full bg-transparent text-white placeholder-gray-500 p-3 max-h-[200px] min-h-[50px] outline-none resize-none font-sans"
              />
              <div className="absolute bottom-3 right-3 flex items-center gap-2">
                <button
                  onClick={handleSubmit}
                  disabled={loading || !inputValue.trim()}
                  className="bg-white text-black p-2 rounded-full hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 10l7-7m0 0l7 7m-7-7v18"></path></svg>
                  )}
                </button>
              </div>
            </div>

            {/* Mode Selector Icons */}
            <div className="flex gap-4 mt-1">
              <button
                onClick={() => setActiveMode('copilot')}
                className={`flex items-center justify-center gap-2 w-48 py-2.5 rounded-full text-xs font-medium transition-all duration-300 ${activeMode === 'copilot' ? 'bg-[#111] text-white shadow-[0_0_15px_rgba(255,255,255,0.05)] border border-[#333]' : 'bg-transparent text-gray-500 hover:text-gray-300 border border-transparent'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg> Ask Copilot
              </button>
              <button
                onClick={() => setActiveMode('query')}
                className={`flex items-center justify-center gap-2 w-48 py-2.5 rounded-full text-xs font-medium transition-all duration-300 ${activeMode === 'query' ? 'bg-splunk-green/10 text-splunk-green shadow-[0_0_15px_rgba(101,194,113,0.1)] border border-splunk-green/30' : 'bg-transparent text-gray-500 hover:text-gray-300 border border-transparent'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"></path></svg> Debug SPL
              </button>
              <button
                onClick={() => setActiveMode('onboard')}
                className={`flex items-center justify-center gap-2 w-48 py-2.5 rounded-full text-xs font-medium transition-all duration-300 ${activeMode === 'onboard' ? 'bg-[#111] text-gray-200 shadow-[0_0_15px_rgba(255,255,255,0.05)] border border-[#333]' : 'bg-transparent text-gray-500 hover:text-gray-300 border border-transparent'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg> Onboard Log
              </button>
            </div>

            {/* Quick Samples - Moved Below Modes with Brighter Green Styling */}
            <div className="w-full flex flex-wrap justify-center gap-2 mt-2">
              {activeMode === 'query' && [
                { label: "Typo in sourcetype", query: "index=main soucetype=access_combined | stats count by status" },
                { label: "Missing field value", query: "index=_internal | where component= | stats count by component | head 10" },
                { label: "Expensive query", query: "index=* | stats count" }
              ].map((sample, i) => (
                <button key={i} onClick={() => setInputValue(sample.query)} className="text-[11px] bg-[#0a0a0a] hover:bg-splunk-green/10 border border-splunk-green/50 hover:border-splunk-green text-splunk-green font-medium px-3 py-1.5 rounded-full transition-colors shadow-lg">
                  {sample.label}
                </button>
              ))}
              
              {activeMode === 'onboard' && [
                { label: "Auth failure", query: "2026-06-01 12:04:06 ERROR AuthService - Login failed for user=john.doe ip=192.168.1.105 attempts=3" },
                { label: "Apache access", query: '192.168.1.1 - frank [10/Oct/2024:13:55:36 -0700] "GET /apache_pb.gif HTTP/1.0" 200 2326' },
                { label: "DB error", query: "2026-06-01 14:22:11 FATAL PostgreSQL - Connection refused error=ECONNREFUSED" }
              ].map((sample, i) => (
                <button key={i} onClick={() => setInputValue(sample.query)} className="text-[11px] bg-[#0a0a0a] hover:bg-splunk-green/10 border border-splunk-green/50 hover:border-splunk-green text-splunk-green font-medium px-3 py-1.5 rounded-full transition-colors shadow-lg">
                  {sample.label}
                </button>
              ))}

              {activeMode === 'copilot' && [
                "What should I build next?",
                "What patterns do you see?",
                "How do I optimize my queries?"
              ].map((q, i) => (
                <button key={i} onClick={() => setInputValue(q)} className="text-[11px] bg-[#0a0a0a] hover:bg-splunk-green/10 border border-splunk-green/50 hover:border-splunk-green text-splunk-green font-medium px-3 py-1.5 rounded-full transition-colors shadow-lg">
                  {q}
                </button>
              ))}
            </div>

          </div>
        </div>
      </div>

    </div>
  );
}

export default App;