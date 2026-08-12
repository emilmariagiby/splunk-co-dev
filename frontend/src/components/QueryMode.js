import { useState } from "react";
import { apiFetch } from "../utils/api";

// Sample broken queries for users to try instantly
const SAMPLE_QUERIES = [
    {
        label: "Typo in sourcetype",
        query: "index=main soucetype=access_combined | stats count by status"
    },
    {
        label: "Missing field value",
        query: "index=_internal | where component= | stats count by component | head 10"
    },
    {
        label: "Multiple typos",
        query: "index=_interal | serach error | stats cont(host) as host_count by sorucetype | sort -host_coutn | head 20"
    },
    {
        label: "Wrong command",
        query: "index=main | timechart spna=5m cont by sourcetype"
    },
    {
        label: "⚠️ Expensive query",
        query: "index=* | stats count"
    }
];

// ── Severity config ──────────────────────────────────────────────────────────
const SEVERITY_CONFIG = {
    SAFE:     { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', dot: 'bg-emerald-400',  label: 'Safe' },
    LOW:      { color: 'text-blue-400',    bg: 'bg-blue-500/10',    border: 'border-blue-500/30',    dot: 'bg-blue-400',    label: 'Low' },
    MEDIUM:   { color: 'text-yellow-400',  bg: 'bg-yellow-500/10',  border: 'border-yellow-500/30',  dot: 'bg-yellow-400',  label: 'Medium' },
    HIGH:     { color: 'text-orange-400',  bg: 'bg-orange-500/10',  border: 'border-orange-500/30',  dot: 'bg-orange-400',  label: 'High' },
    CRITICAL: { color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/30',     dot: 'bg-red-500',     label: 'Critical' },
};

// ── Score color map (for Performance Analyzer) ────────────────────────────────
const SCORE_COLOR = {
    emerald: { ring: '#10b981', text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
    green:   { ring: '#65c271', text: 'text-splunk-green', bg: 'bg-splunk-green/10', border: 'border-splunk-green/30' },
    yellow:  { ring: '#facc15', text: 'text-yellow-400',  bg: 'bg-yellow-500/10',  border: 'border-yellow-500/30' },
    orange:  { ring: '#f97316', text: 'text-orange-400',  bg: 'bg-orange-500/10',  border: 'border-orange-500/30' },
    red:     { ring: '#ef4444', text: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/30' },
};

// ── Performance Analyzer component ───────────────────────────────────────────
function PerformanceAnalyzer({ performance }) {
    if (!performance) return null;
    const { metrics, efficiencyScore, tier, color, recommendations } = performance;
    const sc = SCORE_COLOR[color] || SCORE_COLOR.green;

    // SVG ring math
    const radius = 36;
    const circumference = 2 * Math.PI * radius;
    const dashOffset = circumference - (efficiencyScore / 100) * circumference;

    const fmt = (n) => n >= 1_000_000
        ? (n / 1_000_000).toFixed(1) + 'M'
        : n >= 1_000 ? (n / 1_000).toFixed(1) + 'K' : String(n);

    const diskMB = ((metrics.diskUsage || 0) / (1024 * 1024)).toFixed(1);

    const recIcons = { filter: '🔍', time: '⏱️', index: '📂', stats: '📊', ok: '✅' };

    return (
        <div className={`rounded-xl border ${sc.border} ${sc.bg} p-5 mt-2`}>
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <svg className={`w-4 h-4 ${sc.text}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    <span className={`text-sm font-semibold ${sc.text} uppercase tracking-wide`}>Performance Analyzer</span>
                </div>
                <span className={`text-xs font-bold px-2 py-1 rounded-full border ${sc.bg} ${sc.border} ${sc.text}`}>{tier}</span>
            </div>

            <div className="flex items-start gap-6">
                {/* Score ring */}
                <div className="flex-shrink-0 flex flex-col items-center gap-1">
                    <svg width="90" height="90" viewBox="0 0 90 90">
                        {/* Background ring */}
                        <circle cx="45" cy="45" r={radius} fill="none" stroke="#1a1a1a" strokeWidth="8" />
                        {/* Score ring */}
                        <circle
                            cx="45" cy="45" r={radius}
                            fill="none"
                            stroke={sc.ring}
                            strokeWidth="8"
                            strokeLinecap="round"
                            strokeDasharray={circumference}
                            strokeDashoffset={dashOffset}
                            transform="rotate(-90 45 45)"
                            style={{ transition: 'stroke-dashoffset 1s ease-out' }}
                        />
                        <text x="45" y="49" textAnchor="middle" fontSize="18" fontWeight="bold" fill={sc.ring}>{efficiencyScore}</text>
                    </svg>
                    <span className="text-xs text-gray-500">/ 100</span>
                </div>

                {/* Metrics grid */}
                <div className="flex-1 grid grid-cols-2 gap-3">
                    <div className="bg-black/20 rounded-lg p-3">
                        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Events Scanned</div>
                        <div className="text-lg font-mono font-bold text-white">{fmt(metrics.scanCount)}</div>
                    </div>
                    <div className="bg-black/20 rounded-lg p-3">
                        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Events Matched</div>
                        <div className="text-lg font-mono font-bold text-white">{fmt(metrics.eventCount)}</div>
                    </div>
                    <div className="bg-black/20 rounded-lg p-3">
                        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Run Duration</div>
                        <div className="text-lg font-mono font-bold text-white">{parseFloat(metrics.runDuration || 0).toFixed(2)}s</div>
                    </div>
                    <div className="bg-black/20 rounded-lg p-3">
                        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Disk Used</div>
                        <div className="text-lg font-mono font-bold text-white">{diskMB} MB</div>
                    </div>
                </div>
            </div>

            {/* Efficiency ratio bar */}
            {metrics.scanCount > 0 && (
                <div className="mt-4">
                    <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                        <span>Scan Efficiency (matched / scanned)</span>
                        <span>{((metrics.eventCount / metrics.scanCount) * 100).toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
                        <div
                            className="h-full rounded-full transition-all duration-1000"
                            style={{
                                width: `${Math.min(100, (metrics.eventCount / metrics.scanCount) * 100)}%`,
                                backgroundColor: sc.ring
                            }}
                        />
                    </div>
                </div>
            )}

            {/* Recommendations */}
            {recommendations && recommendations.length > 0 && (
                <div className="mt-4 space-y-2">
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider">Recommendations</div>
                    {recommendations.map((rec, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-gray-300">
                            <span>{recIcons[rec.type] || '•'}</span>
                            <span className="leading-relaxed">{rec.message}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Severity Badge component ─────────────────────────────────────────────────
function SeverityBadge({ severity }) {
    const cfg = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.SAFE;
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${cfg.bg} ${cfg.border} ${cfg.color}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${severity === 'CRITICAL' ? 'animate-pulse' : ''}`}></span>
            {cfg.label}
        </span>
    );
}

// ── Cost Shield Panel component ──────────────────────────────────────────────
function CostShieldPanel({ validation, onOverride, overrideLoading }) {
    const [expanded, setExpanded] = useState(false);
    if (!validation) return null;

    const cfg = SEVERITY_CONFIG[validation.severity] || SEVERITY_CONFIG.SAFE;
    const isBlocked = validation.isBlocked;

    return (
        <div className={`rounded-xl border ${cfg.border} ${cfg.bg} overflow-hidden`}>
            {/* Header */}
            <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer"
                onClick={() => setExpanded(!expanded)}
            >
                <div className="flex items-center gap-3">
                    {/* Shield icon */}
                    <svg className={`w-4 h-4 ${cfg.color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                            d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <div>
                        <div className="flex items-center gap-2">
                            <span className={`text-sm font-semibold ${cfg.color}`}>Cost Shield</span>
                            <SeverityBadge severity={validation.severity} />
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">{validation.summary}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {validation.violations.length > 0 && (
                        <span className="text-xs text-gray-500">{validation.violations.length} issue{validation.violations.length > 1 ? 's' : ''}</span>
                    )}
                    <svg className={`w-4 h-4 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                </div>
            </div>

            {/* Violations list */}
            {expanded && validation.violations.length > 0 && (
                <div className="border-t border-white/5 px-4 py-3 space-y-3">
                    {validation.violations.map((v, i) => {
                        const vcfg = SEVERITY_CONFIG[v.severity] || SEVERITY_CONFIG.LOW;
                        return (
                            <div key={i} className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <SeverityBadge severity={v.severity} />
                                    <span className="text-xs font-semibold text-gray-200">{v.label}</span>
                                </div>
                                <p className="text-xs text-gray-400 leading-relaxed">{v.message}</p>
                                <p className={`text-xs font-medium ${vcfg.color}`}>
                                    💡 Fix: {v.fix}
                                </p>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* CRITICAL block + override */}
            {isBlocked && (
                <div className="border-t border-red-500/20 px-4 py-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-red-300">
                        This query has been <span className="font-bold">blocked</span> to protect your Splunk environment. Fix the issues above, or override to proceed anyway.
                    </p>
                    <button
                        onClick={onOverride}
                        disabled={overrideLoading}
                        className="flex-shrink-0 text-xs bg-red-900/60 hover:bg-red-800/80 border border-red-500/40 text-red-300 hover:text-red-100 px-3 py-1.5 rounded-lg transition-all font-medium disabled:opacity-50"
                    >
                        {overrideLoading ? 'Analyzing...' : 'Override & Analyze Anyway'}
                    </button>
                </div>
            )}
        </div>
    );
}

// ── Main QueryMode component ─────────────────────────────────────────────────
function QueryMode({ 
    result, 
    setInputValue, 
    loading,
    splunkResults,
    setSplunkResults,
    splunkLoading,
    setSplunkLoading,
    migrateResult,
    setMigrateResult,
    migrateLoading,
    setMigrateLoading,
    aiAnalysis,
    setAiAnalysis,
    analyzeLoading,
    setAnalyzeLoading
}) {

    // Override state for CRITICAL queries
    const [overrideLoading, setOverrideLoading] = useState(false);

    const [error, setError] = useState(null);
    const [expandedRow, setExpandedRow] = useState(null);

    const [copied, setCopied] = useState(null);
    const handleCopy = (text, label) => {
        navigator.clipboard.writeText(text);
        setCopied(label);
        setTimeout(() => setCopied(null), 2000);
    };

    // Called when user clicks "Override & Analyze Anyway" on a CRITICAL query
    const handleOverrideCritical = async () => {
        if (!result) return; // result here is the blocked result from parent
        setOverrideLoading(true);
        // We don't have the original query text here - parent handles submit
        // Instead emit a custom event that App.js can catch with overrideCritical=true
        window.dispatchEvent(new CustomEvent('codev:overrideCritical'));
        setOverrideLoading(false);
    };

    const handleRunInSplunk = async () => {
        if (!result?.fixed) return;

        setSplunkLoading(true);
        setSplunkResults(null);
        setError(null);

        try {
            const response = await apiFetch("/api/splunk", {
                method: "POST",
                body: JSON.stringify({ query: result.fixed }),
            });

            const data = await response.json();
            setSplunkResults(data);
        } catch (err) {
            setError("Could not run query in Splunk.");
        } finally {
            setSplunkLoading(false);
        }
    };

    const handleMigrate = async () => {
        if (!result?.fixed) return;

        setMigrateLoading(true);
        setMigrateResult(null);
        setError(null);

        try {
            const response = await apiFetch("/api/migrate", {
                method: "POST",
                body: JSON.stringify({ query: result.fixed }),
            });

            const data = await response.json();
            setMigrateResult(data);
        } catch (err) {
            setError("Could not migrate query to SPL2.");
        } finally {
            setMigrateLoading(false);
        }
    };

    const handleAnalyzeResults = async () => {
        if (!splunkResults?.results?.length) return;

        setAnalyzeLoading(true);
        setAiAnalysis({ response: "" });

        try {
            const response = await apiFetch("/api/copilot/analyze", {
                method: "POST",
                body: JSON.stringify({
                    message: `Analyze the following live Splunk search results. 
Context: I originally tried to run this query: \`${result?.original || 'unknown'}\`. The AI Copilot fixed it and added limits to: \`${result?.fixed || 'unknown'}\`.

Based on these results:
1. What patterns or anomalies do you see?
2. Are there any potential issues (errors, security concerns, performance problems)?
3. Given my original query intent, is this result expected or should I take further action?

Results (first 10 rows): ${JSON.stringify(splunkResults.results.slice(0, 10), null, 2)}`
                }),
            });

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
                    try {
                        const evt = JSON.parse(payload);
                        if (currentEvent === "token") {
                            setAiAnalysis(prev => ({ response: prev.response + (evt.token ?? "") }));
                        } else if (currentEvent === "done") {
                            // final done
                        } else if (currentEvent === "error") {
                            throw new Error(evt.error || "Analysis stream error");
                        }
                    } catch { /* ignore malformed lines */ }
                    currentEvent = "";
                }
            }
        } catch (err) {
            setError("Could not analyze results: " + err.message);
        } finally {
            setAnalyzeLoading(false);
        }
    };

    return (
        <div className="space-y-6">

            {!result && !loading && (
                <div className="space-y-4">
                    <h2 className="text-xl font-semibold text-white">SPL Debugger</h2>
                    <p className="text-gray-400 text-sm">
                        Paste your SPL query below. The Cost Shield checks for expensive patterns instantly,
                        then AI fixes errors, warns about costs, and explains what the query does.
                    </p>
                </div>
            )}

            {/* Error message */}
            {error && (
                <div className="bg-[#1a0a0a] border border-red-900/50 text-red-300 px-4 py-3 rounded-lg text-sm">
                    {error}
                </div>
            )}

            {/* ── BLOCKED query state ──────────────────────────────────────────── */}
            {result?.blocked && (
                <div className="space-y-4">
                    <CostShieldPanel
                        validation={result.validation}
                        onOverride={handleOverrideCritical}
                        overrideLoading={overrideLoading}
                    />
                    <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4">
                        <h3 className="text-gray-500 text-xs font-semibold mb-2 uppercase tracking-wide">Blocked Query</h3>
                        <code className="text-red-400 text-sm font-mono break-all">{result.original}</code>
                    </div>
                </div>
            )}

            {/* ── Normal analysis results ──────────────────────────────────────── */}
            {result && !result.blocked && (
                <div className="space-y-5">

                    {/* Cost Shield always shown at top when we have validation */}
                    {result.validation && (
                        <CostShieldPanel
                            validation={result.validation}
                            onOverride={null}
                            overrideLoading={false}
                        />
                    )}

                    {/* Fixed query */}
                    <div className="bg-[#0a0a0a] border border-splunk-green/30 rounded-xl p-5 shadow-[0_0_20px_rgba(101,194,113,0.05)]">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-splunk-green text-sm font-semibold uppercase tracking-wide">
                                Optimized Query
                            </h3>
                            <button
                                onClick={() => handleCopy(result.fixed, 'fixed')}
                                className="text-xs bg-white/5 hover:bg-white/10 text-gray-300 px-3 py-1.5 rounded transition-colors border border-white/10"
                            >
                                {copied === 'fixed' ? '✓ Copied!' : 'Copy'}
                            </button>
                        </div>
                        <code className="text-white text-sm font-mono break-all">{result.fixed}</code>

                        {/* Action buttons */}
                        <div className="mt-4 pt-4 border-t border-[#1a1a1a] flex gap-3">
                            <button
                                onClick={handleRunInSplunk}
                                disabled={splunkLoading}
                                className="flex items-center gap-2 bg-splunk-green hover:bg-splunk-green/90 disabled:bg-[#111] disabled:text-gray-500 text-black font-semibold px-4 py-2 rounded-lg text-sm transition-colors border border-transparent shadow-[0_0_15px_rgba(101,194,113,0.3)]"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                {splunkLoading ? "Running..." : "Run in Splunk"}
                            </button>

                            <button
                                onClick={handleMigrate}
                                disabled={migrateLoading}
                                className="flex items-center gap-2 bg-splunk-green hover:bg-splunk-green/90 disabled:bg-[#111] disabled:text-gray-500 text-black font-semibold px-4 py-2 rounded-lg text-sm transition-colors border border-transparent shadow-[0_0_15px_rgba(101,194,113,0.3)]"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                                {migrateLoading ? "Migrating..." : "Migrate to SPL2"}
                            </button>
                        </div>
                    </div>

                    {/* AI cost warning (from Groq, complementary to Cost Shield) */}
                    {result.cost_warning && (
                        <div className="bg-[#111] border border-yellow-500/30 rounded-xl p-4">
                            <h3 className="flex items-center gap-2 text-yellow-400 text-sm font-semibold mb-2">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                                AI Cost Analysis
                            </h3>
                            <p className="text-yellow-200/80 text-sm leading-relaxed">{result.cost_warning}</p>
                        </div>
                    )}

                    {/* Original vs Fixed side by side */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4">
                            <h3 className="text-gray-500 text-xs font-semibold mb-3 uppercase tracking-wide">Original Query</h3>
                            <code className="text-red-300 text-sm font-mono break-all leading-relaxed">{result.original}</code>
                        </div>

                        <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-splunk-green text-xs font-semibold uppercase tracking-wide">Fixed Query</h3>
                                <button
                                    onClick={() => handleCopy(result.fixed, 'fixed-side')}
                                    className="text-xs bg-[#111] hover:bg-[#222] text-gray-300 px-2 py-1 rounded transition-colors border border-[#333]"
                                >
                                    {copied === 'fixed-side' ? '✓ Copied!' : 'Copy'}
                                </button>
                            </div>
                            <code className="text-splunk-green text-sm font-mono break-all leading-relaxed">{result.fixed}</code>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Issues found */}
                        <div className="bg-[#0a0a0a] border border-red-900/50 rounded-xl p-5 shadow-[0_0_20px_rgba(239,68,68,0.05)]">
                            <h3 className="text-red-400 text-xs font-semibold mb-3 uppercase tracking-wide">
                                Issues Found
                            </h3>
                            <p className="text-red-300 text-sm leading-relaxed">{result.issues}</p>
                        </div>

                        {/* Explanation */}
                        <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-5">
                            <h3 className="text-gray-500 text-xs font-semibold mb-3 uppercase tracking-wide">
                                Explanation
                            </h3>
                            <p className="text-gray-300 text-sm leading-relaxed">{result.explanation}</p>
                        </div>
                    </div>

                    {/* SPL2 migration result */}
                    {migrateResult && (
                        <div className="bg-purple-500/10 backdrop-blur-md border border-purple-500/30 rounded-xl p-5 space-y-4 shadow-[0_0_20px_rgba(168,85,247,0.1)]">
                            <div className="flex items-center justify-between">
                                <h3 className="flex items-center gap-2 text-purple-400 text-sm font-semibold uppercase tracking-wide">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                                    SPL2 Migration
                                </h3>
                                <button
                                    onClick={() => handleCopy(migrateResult.spl2, 'spl2')}
                                    className="text-xs bg-white/5 hover:bg-white/10 text-gray-300 px-2 py-1 rounded transition-colors border border-white/10"
                                >
                                    {copied === 'spl2' ? '✓ Copied!' : 'Copy'}
                                </button>
                            </div>
                            <code className="text-purple-300 text-sm font-mono break-all block p-3 bg-black/20 rounded-lg">
                                {migrateResult.spl2}
                            </code>
                            <p className="text-gray-400 text-xs leading-relaxed">{migrateResult.explanation}</p>
                        </div>
                    )}

                </div>
            )}

            {/* Live Splunk Results */}
            {splunkResults && (
                <div className="bg-[#0a0a0a] border border-splunk-green/30 rounded-xl overflow-hidden shadow-[0_0_30px_rgba(101,194,113,0.07)]">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-[#1a1a1a]">
                        <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-splunk-green animate-pulse"></div>
                            <h3 className="text-splunk-green text-sm font-semibold uppercase tracking-wide">
                                Live Splunk Results
                            </h3>
                            <span className="text-xs text-black bg-splunk-green font-bold px-2 py-0.5 rounded-full">
                                {splunkResults.total} rows
                            </span>
                        </div>
                        <span className="text-gray-600 text-xs font-mono">
                            realtime
                        </span>
                    </div>

                    {splunkResults.results.length === 0 ? (
                        <p className="text-gray-500 text-sm p-5">No results returned. Try a different query.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs font-mono border-collapse">
                                <thead>
                                    <tr className="border-b border-[#1a1a1a] bg-[#050505]">
                                        {Object.keys(splunkResults.results[0])
                                            .filter(k => !k.startsWith('_'))
                                            .map((field, i) => (
                                                <th key={i} className="px-4 py-3 text-left text-gray-500 font-semibold whitespace-nowrap uppercase text-[10px] tracking-wider">
                                                    {field}
                                                </th>
                                            ))}
                                        <th className="px-4 py-3 text-left text-gray-500 font-semibold uppercase text-[10px] tracking-wider">_raw event</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {splunkResults.results.map((row, i) => (
                                        <tr key={i} className="border-b border-[#111] hover:bg-splunk-green/5 transition-colors group">
                                            {Object.keys(splunkResults.results[0])
                                                .filter(k => !k.startsWith('_'))
                                                .map((field, j) => (
                                                    <td key={j} className="px-4 py-3 text-splunk-green whitespace-nowrap max-w-[150px] truncate">
                                                        {row[field]}
                                                    </td>
                                                ))}
                                            <td className="px-4 py-3 text-gray-500 group-hover:text-gray-300 max-w-sm truncate transition-colors font-mono">
                                                {row._raw?.substring(0, 100)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* Performance Analyzer — shown after live results */}
            {splunkResults?.performance && (
                <PerformanceAnalyzer performance={splunkResults.performance} />
            )}

            {/* AI Analysis Action */}
            {splunkResults && !aiAnalysis && (
                <div className="flex justify-end mt-4">
                    <button
                        onClick={handleAnalyzeResults}
                        disabled={analyzeLoading}
                        className="flex items-center gap-2 bg-transparent border-2 border-splunk-green text-splunk-green hover:bg-splunk-green hover:text-black font-semibold px-5 py-2 rounded-lg text-sm shadow-[0_0_15px_rgba(101,194,113,0.15)] hover:shadow-[0_0_20px_rgba(101,194,113,0.4)] transition-all disabled:opacity-50"
                    >
                        {analyzeLoading ? (
                            <>
                                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Analyzing Live Data...
                            </>
                        ) : (
                            <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                                Analyze Results with Copilot
                            </>
                        )}
                    </button>
                </div>
            )}

            {/* AI Analysis Panel */}
            {aiAnalysis && (
                <div className="bg-[#0a0a0a] border border-splunk-green/30 rounded-xl p-5 mt-4 shadow-[0_0_30px_rgba(101,194,113,0.07)]">
                    <h3 className="flex items-center gap-2 text-splunk-green text-sm font-semibold uppercase tracking-wide mb-4">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path></svg>
                        Copilot Data Analysis
                    </h3>
                    <div className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap font-mono">
                        {aiAnalysis.response || aiAnalysis.message || aiAnalysis.content || JSON.stringify(aiAnalysis)}
                    </div>
                </div>
            )}
        </div>
    );
}

export default QueryMode;