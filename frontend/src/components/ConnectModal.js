import React, { useState } from 'react';

export default function ConnectModal({ onConnect }) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('8089');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [hecToken, setHecToken] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!host || !username || !password) return;
    
    const creds = { host, port, username, password, hecToken };
    localStorage.setItem('splunkCreds', JSON.stringify(creds));
    onConnect();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl p-8 w-full max-w-md shadow-2xl">
        <h2 className="text-2xl font-light text-white mb-2">Connect to Splunk</h2>
        <p className="text-gray-400 text-sm mb-6">
          Provide your Splunk instance credentials to continue. This data is stored locally in your browser.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Host / URL</label>
            <input 
              type="text" 
              value={host}
              onChange={e => setHost(e.target.value)}
              placeholder="e.g. localhost or https://prd-p-xxxx.splunkcloud.com" 
              className="w-full bg-[#111] border border-[#222] focus:border-splunk-green/50 text-white px-4 py-2 rounded outline-none transition-colors"
              required
            />
          </div>
          
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Management Port</label>
            <input 
              type="text" 
              value={port}
              onChange={e => setPort(e.target.value)}
              placeholder="8089" 
              className="w-full bg-[#111] border border-[#222] focus:border-splunk-green/50 text-white px-4 py-2 rounded outline-none transition-colors"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Username</label>
            <input 
              type="text" 
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="admin" 
              className="w-full bg-[#111] border border-[#222] focus:border-splunk-green/50 text-white px-4 py-2 rounded outline-none transition-colors"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Password</label>
            <input 
              type="password" 
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" 
              className="w-full bg-[#111] border border-[#222] focus:border-splunk-green/50 text-white px-4 py-2 rounded outline-none transition-colors"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">HEC Token (Optional)</label>
            <input 
              type="password" 
              value={hecToken}
              onChange={e => setHecToken(e.target.value)}
              placeholder="For telemetry logging" 
              className="w-full bg-[#111] border border-[#222] focus:border-splunk-green/50 text-white px-4 py-2 rounded outline-none transition-colors"
            />
          </div>

          <button 
            type="submit"
            className="w-full bg-splunk-green text-black font-semibold py-3 rounded hover:bg-splunk-green/90 transition-colors mt-4"
          >
            Connect
          </button>
        </form>
      </div>
    </div>
  );
}
