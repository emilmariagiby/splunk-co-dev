import React, { useState, useRef, useEffect } from "react";
import { apiFetch } from "../utils/api";

function OptimizerMode() {
  const [events, setEvents] = useState([]);
  const [optimizations, setOptimizations] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [deployStatuses, setDeployStatuses] = useState({});
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, optimizations]);

  const startScan = async () => {
    setEvents([]);
    setOptimizations([]);
    setIsScanning(true);
    setDeployStatuses({});

    try {
      const response = await apiFetch("/api/optimizer/scan");
      if (!response.body) throw new Error("ReadableStream not supported");
      
      const reader = response.body.getReader();
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
          const eventTypeToSave = currentEvent;
          
          try {
            const evtData = JSON.parse(payload);
            if (eventTypeToSave === "optimization_found") {
                setOptimizations(prev => [...prev, evtData]);
            } else {
                setEvents(prev => [...prev, { type: eventTypeToSave, data: evtData }]);
            }
          } catch { /* ignore malformed lines */ }
          currentEvent = "";
        }
      }
    } catch (err) {
      setEvents(prev => [...prev, { type: "error", data: { message: err.message } }]);
    } finally {
      setIsScanning(false);
    }
  };

  const handleDeploy = async (opt, idx) => {
    setDeployStatuses(prev => ({ ...prev, [idx]: 'deploying' }));
    try {
      const res = await apiFetch("/api/optimizer/deploy", {
        method: "POST",
        body: JSON.stringify({
          name: opt.name,
          app: opt.app,
          owner: opt.owner,
          sharing: opt.sharing,
          optimized_query: opt.optimized_query
        })
      });
      const data = await res.json();
      if (res.ok) {
        setDeployStatuses(prev => ({ ...prev, [idx]: 'success' }));
      } else {
        alert("Deploy failed: " + (data.error || "Unknown error"));
        setDeployStatuses(prev => ({ ...prev, [idx]: 'error' }));
      }
    } catch (err) {
      alert("Deploy failed: " + err.message);
      setDeployStatuses(prev => ({ ...prev, [idx]: 'error' }));
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a] text-gray-200">
      <div className="p-6 border-b border-[#222]">
        <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400 mb-2">
          Autonomous Slow Query Tuner
        </h2>
        <p className="text-gray-400 mb-4 text-sm">
          Scans your Splunk instance natively via REST API to find expensive anti-patterns (e.g. index=*) in saved searches and provides 1-click optimization hot-swaps.
        </p>
        <button
          onClick={startScan}
          disabled={isScanning}
          className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white font-semibold py-2 px-6 rounded-md transition-colors"
        >
          {isScanning ? "Scanning Splunk..." : "Scan Saved Searches"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6" ref={scrollRef}>
        {events.length === 0 && optimizations.length === 0 && !isScanning && (
          <div className="flex items-center justify-center h-full text-gray-500">
            Click "Scan Saved Searches" to begin AI analysis of your Splunk instance.
          </div>
        )}

        {/* Stream Console Logs */}
        {events.map((evt, idx) => (
          <div key={`evt-${idx}`} className={`font-mono text-xs ${evt.type === 'error' ? 'text-red-400' : 'text-gray-500'}`}>
            [{evt.type.toUpperCase()}] {evt.data.message || JSON.stringify(evt.data)}
          </div>
        ))}

        {/* Optimization Cards */}
        {optimizations.map((opt, idx) => (
          <div key={`opt-${idx}`} className="bg-[#111] border border-orange-500/30 rounded-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-orange-400">{opt.name}</h3>
                <p className="text-xs text-gray-500">App: {opt.app} | Owner: {opt.owner}</p>
              </div>
              <button
                onClick={() => handleDeploy(opt, idx)}
                disabled={deployStatuses[idx] === 'deploying' || deployStatuses[idx] === 'success'}
                className={`py-1 px-4 rounded font-bold text-sm transition-colors ${
                  deployStatuses[idx] === 'success' ? 'bg-green-600 text-white' :
                  deployStatuses[idx] === 'deploying' ? 'bg-gray-600 text-white' :
                  'bg-orange-600 hover:bg-orange-500 text-white'
                }`}
              >
                {deployStatuses[idx] === 'success' ? 'Hot-Swapped!' : 
                 deployStatuses[idx] === 'deploying' ? 'Deploying...' : 
                 'Hot-Swap Overwrite'}
              </button>
            </div>
            
            <div className="mb-4 bg-red-950/20 border border-red-500/20 p-3 rounded text-sm text-red-200">
              <strong>Anti-Pattern Reason:</strong> {opt.reason}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[#050505] p-3 rounded border border-gray-800">
                <div className="text-[10px] text-red-400 uppercase tracking-wider mb-2 font-bold">Original Query (Inefficient)</div>
                <code className="text-sm font-mono text-gray-400 break-all">{opt.original_query}</code>
              </div>
              <div className="bg-[#050505] p-3 rounded border border-emerald-900/30">
                <div className="text-[10px] text-emerald-400 uppercase tracking-wider mb-2 font-bold">Optimized Query (AI Suggested)</div>
                <code className="text-sm font-mono text-emerald-300 break-all">{opt.optimized_query}</code>
              </div>
            </div>
          </div>
        ))}
        
        {isScanning && (
          <div className="text-blue-400 animate-pulse text-sm font-mono">
            Analyzing Splunk API responses with Llama-3...
          </div>
        )}
      </div>
    </div>
  );
}

export default OptimizerMode;
