import { useState } from "react";
import { apiFetch } from "../utils/api";

function OnboardMode({ result, setInputValue, loading }) {
    // Copy text to clipboard and show brief feedback
    const [copied, setCopied] = useState(null);

    const handleCopy = (text, label) => {
        navigator.clipboard.writeText(text);
        setCopied(label);
        // Reset the "Copied!" message after 2 seconds
        setTimeout(() => setCopied(null), 2000);
    };

    const [deployStatus, setDeployStatus] = useState(null);

    const handleDeploy = async () => {
        setDeployStatus('deploying');
        try {
            const response = await apiFetch('/api/onboard/deploy', {
                method: 'POST',
                body: JSON.stringify({
                    sourcetype: result.sourcetype,
                    props_conf: result.props_conf
                })
            });
            
            if (response.ok) {
                setDeployStatus('success');
                setTimeout(() => setDeployStatus(null), 3000);
            } else {
                setDeployStatus('error');
                setTimeout(() => setDeployStatus(null), 3000);
            }
        } catch (error) {
            setDeployStatus('error');
            setTimeout(() => setDeployStatus(null), 3000);
        }
    };

    return (
        <div className="space-y-6">

            {!result && !loading && (
                <div className="space-y-4">
                    <h2 className="text-xl font-semibold text-white">Log Onboarding Assistant</h2>
                    <p className="text-gray-400 text-sm">
                        Paste a raw log line below. AI will determine the sourcetype, generate `props.conf` and `transforms.conf` configurations, and extract key fields using regex.
                    </p>
                </div>
            )}

            {/* Results section */}
            {result && (
                <div className="space-y-6">

                    {/* Log description */}
                    <div className="bg-[#0a0a0a] border border-blue-500/30 rounded-xl p-5 shadow-[0_0_20px_rgba(59,130,246,0.05)]">
                        <h3 className="text-blue-400 text-sm font-semibold mb-2 uppercase tracking-wide">What This Log Is</h3>
                        <p className="text-gray-300 text-sm leading-relaxed">{result.description}</p>
                    </div>

                    {/* Recommended sourcetype */}
                    <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4">
                        <h3 className="text-gray-500 text-xs font-semibold mb-2 uppercase tracking-wide">
                            Recommended Sourcetype
                        </h3>
                        <code className="text-splunk-green text-sm font-mono">{result.sourcetype}</code>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* props.conf */}
                        <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4 flex flex-col">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-gray-500 text-xs font-semibold uppercase tracking-wide">
                                    props.conf
                                </h3>
                                <div className="flex gap-2">
                                    <button
                                        onClick={handleDeploy}
                                        disabled={deployStatus === 'deploying'}
                                        className="text-xs bg-splunk-green/20 hover:bg-splunk-green/30 text-splunk-green px-3 py-1 rounded transition-colors border border-splunk-green/50 font-semibold"
                                    >
                                        {deployStatus === 'deploying' ? 'Deploying...' : deployStatus === 'success' ? '✓ Injected!' : deployStatus === 'error' ? 'Error' : 'Deploy to Splunk'}
                                    </button>
                                    <button
                                        onClick={() => handleCopy(result.props_conf, 'props')}
                                        className="text-xs bg-[#111] hover:bg-[#222] text-gray-300 px-2 py-1 rounded transition-colors border border-[#333]"
                                    >
                                        {copied === 'props' ? '✓ Copied!' : 'Copy'}
                                    </button>
                                </div>
                            </div>
                            <pre className="text-yellow-400/90 text-sm font-mono whitespace-pre-wrap bg-black/40 p-3 rounded-lg flex-1 border border-[#1a1a1a]">
                                {result.props_conf}
                            </pre>
                        </div>

                        {/* transforms.conf */}
                        <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4 flex flex-col">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-gray-500 text-xs font-semibold uppercase tracking-wide">
                                    transforms.conf
                                </h3>
                                <button
                                    onClick={() => handleCopy(result.transforms_conf, 'transforms')}
                                    className="text-xs bg-[#111] hover:bg-[#222] text-gray-300 px-2 py-1 rounded transition-colors border border-[#333]"
                                >
                                    {copied === 'transforms' ? '✓ Copied!' : 'Copy'}
                                </button>
                            </div>
                            <pre className="text-yellow-400/90 text-sm font-mono whitespace-pre-wrap bg-black/40 p-3 rounded-lg flex-1 border border-[#1a1a1a]">
                                {result.transforms_conf}
                            </pre>
                        </div>
                    </div>

                    {/* Field extractions */}
                    <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-5">
                        <h3 className="text-gray-500 text-xs font-semibold mb-4 uppercase tracking-wide">
                            Field Extractions
                        </h3>
                        <div className="space-y-3">
                            {result.field_extractions.map((field, index) => (
                                <div key={index} className="border border-[#1a1a1a] bg-[#050505] rounded-lg p-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                        <span className="text-splunk-green text-sm font-semibold">{field.field}</span>
                                        <span className="text-gray-500 text-xs italic">ex: {field.example}</span>
                                    </div>
                                    <code className="text-gray-300 text-xs font-mono break-all">{field.regex}</code>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Summary */}
                    <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4">
                        <h3 className="text-gray-500 text-xs font-semibold mb-2 uppercase tracking-wide">
                            Summary
                        </h3>
                        <p className="text-gray-300 text-sm leading-relaxed">{result.summary}</p>
                    </div>

                </div>
            )}

        </div>
    );
}

export default OnboardMode;