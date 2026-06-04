const express = require('express');
const router = express.Router();
const axios = require('axios');
const { logToSplunk } = require('../services/splunkHEC');
const { validateQuery } = require('../services/queryValidator');
const { readWorkspace } = require('./workspace');
require('dotenv').config();

// This route receives a broken SPL query from the frontend,
// runs it through the Proactive Cost Shield first,
// then sends it to Groq AI for fixing and explanation.
router.post('/', async (req, res) => {

    const { query, overrideCritical } = req.body;

    if (!query) {
        return res.status(400).json({ error: 'No query provided' });
    }

    // ── Step 1: Proactive Cost Shield ─────────────────────────────────────────
    // Run the static rule-based validator BEFORE touching the AI.
    // This is instant — no API call needed.
    const validation = validateQuery(query);

    // If CRITICAL and user has NOT explicitly confirmed override, block immediately.
    // This saves the Groq API call AND protects their Splunk instance.
    if (validation.isBlocked && !overrideCritical) {
        logToSplunk('query_blocked', {
            query,
            severity: validation.severity,
            violations: validation.violations.map(v => v.id)
        });

        return res.json({
            original: query,
            fixed: null,
            issues: null,
            explanation: null,
            cost_warning: null,
            validation, // full validation result
            blocked: true,
        });
    }

    try {
        // ── Step 2: AI Analysis ───────────────────────────────────────────────
        // Build the prompt. We pass the validation results in so the AI can
        // reference the specific issues already detected.
        const validationContext = validation.violations.length > 0
            ? `Pre-analysis detected these issues:\n${validation.violations.map(v => `- [${v.severity}] ${v.label}: ${v.message}`).join('\n')}`
            : 'No pre-analysis issues detected.';

        const workspace = readWorkspace();
        let workspaceContext = '';
        if (workspace && workspace.files && workspace.files.length > 0) {
            workspaceContext = `\nAlso, here is context from the user's local codebase. Use these log statements to figure out the correct fields, indexes, or sourcetypes they might be trying to query:\n`;
            workspace.files.slice(0, 10).forEach(f => {
                workspaceContext += `File: ${f.file}\n`;
                f.logLines.forEach(l => {
                    workspaceContext += `  Line ${l.line}: ${l.code}\n`;
                });
            });
        }

        const prompt = `
You are an expert in Splunk SPL (Search Processing Language).
A user has written the following SPL query which may contain errors:

"${query}"

${validationContext}
${workspaceContext}

Please do the following:
1. Identify what is wrong with the query (if anything)
2. Provide the corrected version of the query
3. Explain in simple terms what the query does and what you fixed
4. Check if this query could be expensive to run (e.g. index=*, missing time filter, wildcard searches, no sourcetype filter). If so, explain why and how to optimize it.

Respond in this exact JSON format with no markdown or backticks:
{
  "original": "the original query",
  "fixed": "the corrected query",
  "issues": "what was wrong",
  "explanation": "what the query does in plain English",
  "cost_warning": "explain why this query is expensive and how to optimize it, or null if the query is not expensive"
}
`;

        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3,
                response_format: { type: 'json_object' }
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const rawText = response.data.choices[0].message.content;
        const cleaned = rawText.replace(/```json|```/g, '').trim();
        const result = JSON.parse(cleaned);

        // Attach the validation result to the response
        result.validation = validation;
        result.blocked = false;

        // Send telemetry to Splunk
        logToSplunk('query_analyzed', {
            original_query: query,
            fixed_query: result.fixed,
            issues_found: result.issues,
            severity: validation.severity,
            violation_count: validation.violations.length,
            has_cost_warning: result.cost_warning !== null,
            override_critical: !!overrideCritical
        });

        res.json(result);

    } catch (error) {
        console.error('Error calling Groq API:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to analyze query' });
    }
});

module.exports = router;