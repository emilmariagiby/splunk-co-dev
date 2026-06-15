const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');
const { logToSplunk } = require('../services/splunkHEC');
require('dotenv').config();

// Create an HTTPS agent that bypasses self-signed cert errors for local Splunk
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Helper function to write Server-Sent Events
const sseWrite = (res, event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

// Helper to reliably extract Splunk error messages from any format (XML/JSON)
const extractSplunkError = (err) => {
    if (err.response && err.response.data) {
        if (typeof err.response.data === 'string') {
            const xmlMatch = err.response.data.match(/<text>(.*?)<\/text>/);
            if (xmlMatch) return xmlMatch[1];
            return err.response.data.substring(0, 200); // Truncate raw string if no match
        } else if (err.response.data.messages && err.response.data.messages.length > 0) {
            return err.response.data.messages[0].text;
        }
        return JSON.stringify(err.response.data);
    }
    return err.message;
};

const ACCURATE_MODEL = 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

router.get('/scan', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
        sseWrite(res, 'error', { message: 'GROQ_API_KEY is not configured.' });
        return res.end();
    }

    try {
        const splunkHost = process.env.SPLUNK_HOST;
        // The REST API expects HTTPS
        const splunkUrl = splunkHost.startsWith('http') ? splunkHost : `https://${splunkHost}:8089`;
        
        const splunkAuth = Buffer.from(`${process.env.SPLUNK_USERNAME}:${process.env.SPLUNK_PASSWORD}`).toString('base64');
        const headers = {
            'Authorization': `Basic ${splunkAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        };

        sseWrite(res, 'info', { message: 'Connecting to Splunk to retrieve saved searches...' });

        // Retrieve all saved searches to scan
        const splunkRes = await axios.get(`${splunkUrl}/servicesNS/-/-/saved/searches?output_mode=json&count=0`, { headers, httpsAgent });
        
        if (!splunkRes.data || !splunkRes.data.entry || splunkRes.data.entry.length === 0) {
            sseWrite(res, 'info', { message: 'No saved searches found in Splunk.' });
            sseWrite(res, 'done', { message: 'Scan complete.' });
            return res.end();
        }

        const entries = splunkRes.data.entry;
        
        // --- ENTERPRISE COST OPTIMIZATION: HEURISTICS PRE-FILTER ---
        // Instead of sending all queries to the expensive LLM, we use cheap local regex
        // to filter out the obvious good queries and only send the suspicious ones.
        const suspiciousEntries = entries.filter(entry => {
            const app = entry.acl?.app || '';
            // Ignore Splunk internal system and utility apps to avoid rate limits
            if (app.startsWith('splunk') || 
                app.startsWith('alert_') || 
                app.startsWith('introspection_') || 
                app === 'audit_trail' || 
                app === 'learned' || 
                app === 'legacy' || 
                app === 'appsbrowser' || 
                app === 'launcher' ||
                app === 'python_upgrade_readiness_app') {
                return false;
            }
            
            const q = (entry.content?.search || '').toLowerCase();
            return q.includes('index=*') || 
                   q.includes('join') || 
                   q.includes('append') || 
                   q.includes('transaction') || 
                   q.includes('dedup') ||
                   q.includes('*error*') ||
                   q.includes('search *') ||
                   q.startsWith('|'); // Leading pipe without an index
        });

        sseWrite(res, 'info', { message: `Heuristics Engine: Filtered ${entries.length} total queries down to ${suspiciousEntries.length} highly suspicious queries.` });

        const CHUNK_SIZE = 20;
        let totalOptimizationsFound = 0;

        for (let i = 0; i < suspiciousEntries.length; i += CHUNK_SIZE) {
            const chunk = suspiciousEntries.slice(i, i + CHUNK_SIZE);
            sseWrite(res, 'info', { message: `Sending batch ${Math.floor(i / CHUNK_SIZE) + 1} of ${Math.ceil(suspiciousEntries.length / CHUNK_SIZE)} to LLM for deep analysis...` });

            let queryCatalog = '';
            chunk.forEach((entry, idx) => {
                queryCatalog += `Name: ${entry.name}\nApp: ${entry.acl?.app}\nOwner: ${entry.acl?.owner}\nSharing: ${entry.acl?.sharing}\nQuery: ${entry.content?.search}\n---\n`;
            });

            const prompt = `
You are an expert Splunk Database Administrator (DBA). 
I am providing you a list of saved searches currently running in my Splunk Enterprise environment.
Your job is to identify "slow", "expensive", or "inefficient" queries.

Look for these anti-patterns:
1. Queries starting with "index=*" or no index specified at all.
2. Extensive use of wildcard prefixes (e.g. *error* instead of TERM(error)).
3. Using 'join' or 'append' instead of 'stats'.
4. Using 'transaction' when 'stats' would be much faster.
5. Inefficient filtering after the first pipe instead of before.

If a query is perfectly fine, IGNORE IT.
If a query is inefficient, flag it, explain why it is bad, and provide the fully optimized SPL.

CRITICAL: You must return ONLY valid JSON. Do not include markdown formatting or conversational text.

Example Output:
{
  "optimizations": [
    {
      "name": "Bad Network Alert",
      "app": "search",
      "owner": "admin",
      "sharing": "app",
      "original_query": "index=* action=blocked | join src_ip [ search index=* infected ]",
      "optimized_query": "index=network action=blocked OR infected | stats values(action) by src_ip",
      "reason": "Using index=* is extremely expensive. 'join' is a massive bottleneck in Splunk. Rewritten to use a single pass with stats."
    }
  ]
}

Here are the queries to analyze:
"""
${queryCatalog}
"""

Return only the JSON array of optimizations.
`;

            try {
                const aiResponse = await axios.post(
                    GROQ_URL,
                    {
                        model: ACCURATE_MODEL,
                        messages: [{ role: 'user', content: prompt }],
                        temperature: 0.1
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${groqKey}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );

                const rawText = aiResponse.data.choices[0].message.content;
                const jsonMatch = rawText.match(/\{[\s\S]*\}/);
                
                if (jsonMatch) {
                    const parsedData = JSON.parse(jsonMatch[0]);
                    if (parsedData.optimizations && parsedData.optimizations.length > 0) {
                        for (const opt of parsedData.optimizations) {
                            sseWrite(res, 'optimization_found', opt);
                            totalOptimizationsFound++;
                        }
                    }
                }
            } catch (chunkError) {
                console.error("Chunk Error:", chunkError.message);
                const isRateLimit = chunkError.response && chunkError.response.status === 429;
                sseWrite(res, 'info', { 
                    message: `Batch ${Math.floor(i / CHUNK_SIZE) + 1} analysis failed: ${isRateLimit ? 'Rate limited by Groq API. Try again in a minute.' : chunkError.message}` 
                });
            }

            // Sleep for 1.5 seconds between batches to avoid rate limits
            if (i + CHUNK_SIZE < entries.length) {
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        }

        if (totalOptimizationsFound === 0) {
            sseWrite(res, 'info', { message: `All ${entries.length} scanned queries are perfectly optimized!` });
        }

        sseWrite(res, 'done', { message: 'Scan completed successfully.' });
        res.end();

    } catch (error) {
        console.error("Optimizer Scan Error:", error);
        sseWrite(res, 'error', { message: error.message });
        res.end();
    }
});

// Route to Hot-Swap an optimized query natively in Splunk
router.post('/deploy', async (req, res) => {
    try {
        const { name, app, owner, sharing, optimized_query } = req.body;
        
        if (!name || !app || !owner || !optimized_query) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const splunkHost = process.env.SPLUNK_HOST;
        const splunkUrl = splunkHost.startsWith('http') ? splunkHost : `https://${splunkHost}:8089`;
        
        const splunkAuth = Buffer.from(`${process.env.SPLUNK_USERNAME}:${process.env.SPLUNK_PASSWORD}`).toString('base64');
        const headers = {
            'Authorization': `Basic ${splunkAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        };

        const data = new URLSearchParams();
        data.append('search', optimized_query);

        // Determine correct namespace (shared vs user private namespace)
        const targetUser = (sharing === 'app' || sharing === 'global') ? 'nobody' : owner;
        const endpoint = `${splunkUrl}/servicesNS/${encodeURIComponent(targetUser)}/${encodeURIComponent(app)}/saved/searches/${encodeURIComponent(name)}?output_mode=json`;
        
        await axios.post(endpoint, data, { headers, httpsAgent });
        
        logToSplunk('agent_optimized_query', { name, optimized_query });

        res.json({ success: true, message: "Query optimized successfully!" });

    } catch (error) {
        console.error("Optimizer Deploy Error:", error);
        res.status(500).json({ error: extractSplunkError(error) });
    }
});

module.exports = router;
