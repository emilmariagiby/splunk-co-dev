import React, { useState } from "react";

function CIMMode({ result, loading, workspace }) {
    const [copied, setCopied] = useState(false);
    const [sourcetype, setSourcetype] = useState("my_log_sourcetype");
    const [writeLoading, setWriteLoading] = useState(false);
    const [writeStatus, setWriteStatus] = useState(null);

    const handleCopy = (text) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleAutoWrite = async () => {
        if (!result?.props_conf_aliases) return;
        setWriteLoading(true);
        setWriteStatus(null);
        try {
            const res = await fetch("http://localhost:3002/api/cim/write-conf", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    props_conf_aliases: result.props_conf_aliases,
                    sourcetype: sourcetype.trim()
                })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setWriteStatus({ success: true, message: data.message });
        } catch (err) {
            setWriteStatus({ success: false, message: err.message || "Failed to write config" });
        } finally {
            setWriteLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            {!result && !loading && (
                <div className="space-y-4 text-center mt-10">
                    <svg className="w-16 h-16 text-splunk-green mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <h2 className="text-2xl font-light text-white mb-2">CIM Compliance Auto-Mapper</h2>
                    <p className="text-gray-400 text-sm max-w-md mx-auto leading-relaxed">
                        Paste a raw log or JSON payload below. The AI will automatically detect custom fields (e.g. source_ip_address) and generate the exact FIELDALIAS configurations to map them to the Splunk Common Information Model (e.g. src).
                    </p>
                </div>
            )}

            {result && (
                <div className="space-y-6">
                    {/* Summary */}
                    <div className="bg-[#0a0a0a] border border-blue-500/30 rounded-xl p-5 shadow-[0_0_20px_rgba(59,130,246,0.05)]">
                        <h3 className="text-blue-400 text-sm font-semibold mb-2 uppercase tracking-wide flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            CIM Model Assignment
                        </h3>
                        <p className="text-gray-300 text-sm leading-relaxed">{result.summary}</p>
                    </div>

                    {/* Detected Fields Table */}
                    <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl overflow-hidden">
                        <div className="p-4 border-b border-[#1a1a1a] bg-[#111]">
                            <h3 className="text-gray-500 text-xs font-semibold uppercase tracking-wide">
                                Field Mappings
                            </h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm text-gray-400">
                                <thead className="bg-[#151515] text-xs uppercase text-gray-500 border-b border-[#1a1a1a]">
                                    <tr>
                                        <th className="px-4 py-3">Raw Field</th>
                                        <th className="px-4 py-3 text-splunk-green">CIM Field</th>
                                        <th className="px-4 py-3">Example Value</th>
                                        <th className="px-4 py-3">Explanation</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#1a1a1a]">
                                    {result.detected_fields?.map((field, idx) => (
                                        <tr key={idx} className="hover:bg-[#111] transition-colors">
                                            <td className="px-4 py-3 font-mono text-gray-300">{field.raw_field}</td>
                                            <td className="px-4 py-3 font-mono text-splunk-green font-bold bg-splunk-green/5">
                                                {field.cim_field}
                                            </td>
                                            <td className="px-4 py-3 font-mono text-xs">{field.example_value}</td>
                                            <td className="px-4 py-3 text-xs">{field.explanation}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* props.conf output & Workspace Save */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-5 flex flex-col relative">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-gray-500 text-xs font-semibold uppercase tracking-wide">
                                    Generated props.conf (FIELDALIAS)
                                </h3>
                                <button
                                    onClick={() => handleCopy(result.props_conf_aliases)}
                                    className="text-xs bg-[#111] hover:bg-[#222] text-gray-300 px-3 py-1.5 rounded transition-colors border border-[#333] flex items-center gap-2"
                                >
                                    {copied ? (
                                        <>
                                            <svg className="w-3.5 h-3.5 text-splunk-green" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                                            Copied!
                                        </>
                                    ) : (
                                        <>
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                            Copy Aliases
                                        </>
                                    )}
                                </button>
                            </div>
                            <pre className="text-yellow-400/90 text-sm font-mono whitespace-pre-wrap bg-black/50 p-4 rounded-lg flex-1 border border-[#222] shadow-inner">
                                {result.props_conf_aliases}
                            </pre>
                        </div>

                        <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-5 flex flex-col justify-between">
                            <div>
                                <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-3">
                                    Direct Workspace Integration
                                </h3>
                                <p className="text-xs text-gray-500 leading-relaxed mb-4">
                                    If you have connected a local workspace, you can automatically append these field alias configurations directly to your local <code className="text-gray-400">props.conf</code>.
                                </p>

                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Sourcetype Stanza Name</label>
                                        <input
                                            type="text"
                                            value={sourcetype}
                                            onChange={(e) => setSourcetype(e.target.value)}
                                            placeholder="e.g. access_combined"
                                            className="w-full bg-black/30 border border-[#222] focus:border-splunk-green/50 text-white text-xs px-3 py-2 rounded-lg outline-none transition-colors"
                                        />
                                    </div>

                                    {workspace ? (
                                        <div className="text-xs bg-splunk-green/5 border border-splunk-green/20 rounded-lg p-3">
                                            <span className="text-splunk-green font-semibold">Active Workspace: </span>
                                            <span className="text-gray-300 font-mono text-[10px] block truncate mt-1">{workspace.folderPath}</span>
                                        </div>
                                    ) : (
                                        <div className="text-xs bg-red-950/20 border border-red-900/30 text-red-300 rounded-lg p-3">
                                            ⚠️ No workspace connected. Please connect a workspace in the sidebar first to write files directly.
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="mt-6 pt-4 border-t border-[#1a1a1a] space-y-3">
                                <button
                                    onClick={handleAutoWrite}
                                    disabled={writeLoading || !workspace || !sourcetype.trim()}
                                    className="w-full bg-splunk-green hover:bg-splunk-green/90 disabled:bg-[#111] disabled:text-gray-500 text-black font-semibold py-2.5 rounded-lg text-sm transition-all shadow-[0_0_15px_rgba(101,194,113,0.15)] flex items-center justify-center gap-1.5"
                                >
                                    {writeLoading ? (
                                        <>
                                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                            Writing to props.conf...
                                        </>
                                    ) : (
                                        <>
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V8m-2-4h-4m-2 4h.01M9 16h3m3 0h3" /></svg>
                                            Write to local/props.conf
                                        </>
                                    )}
                                </button>

                                {writeStatus && (
                                    <div className={`text-xs p-3 rounded-lg border ${writeStatus.success ? 'bg-emerald-950/20 border-emerald-900/30 text-emerald-400' : 'bg-red-950/20 border-red-900/30 text-red-400'}`}>
                                        {writeStatus.message}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default CIMMode;
