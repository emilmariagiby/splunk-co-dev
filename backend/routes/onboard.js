const express = require('express');
const router = express.Router();
const axios = require('axios');
const { logToSplunk } = require('../services/splunkHEC');
const { readWorkspace } = require('./workspace');
require('dotenv').config();

// This route receives a raw log sample from the frontend
// sends it to Groq AI, and returns Splunk configuration recommendations
router.post('/', async (req, res) => {

    // Get the raw log sample from the request body
    const { logSample } = req.body;

    // If no log sample was sent, return an error immediately
    if (!logSample) {
        return res.status(400).json({ error: 'No log sample provided' });
    }

    try {
      const workspace = readWorkspace();
      let workspaceContext = '';
      if (workspace && workspace.files && workspace.files.length > 0) {
          workspaceContext = `\nAlso, here is context from the user's local codebase. Use these log statements to deduce the application name, appropriate sourcetypes, or variable names:\n`;
          workspace.files.slice(0, 10).forEach(f => {
              workspaceContext += `File: ${f.file}\n`;
              f.logLines.forEach(l => {
                  workspaceContext += `  Line ${l.line}: ${l.code}\n`;
              });
          });
      }

      // Build the prompt for Groq
      // We're asking it to act as a Splunk admin and analyze the log
      const prompt = `
      You are an expert Splunk administrator with deep knowledge of
      log onboarding, sourcetypes, and field extractions.
      
      A user has provided the following raw log sample:
      
      "${logSample}"

      ${workspaceContext}
      
      Please analyze this log and provide:
      1. The recommended sourcetype name
      2. The props.conf configuration
      3. The transforms.conf configuration if needed
      4. Key field extractions using regex
      5. A plain English explanation of what this log represents
      
      Respond in this exact JSON format with no markdown or backticks:
      {
        "sourcetype": "recommended sourcetype name",
        "description": "what this log represents in plain English",
        "props_conf": "the full props.conf configuration",
        "transforms_conf": "the transforms.conf configuration or Not needed",
        "field_extractions": [
          {
            "field": "field name",
            "regex": "regex pattern to extract it",
            "example": "example value from the log"
          }
        ],
        "summary": "brief explanation of what to do with this config"
      }
    `;

        // Call the Groq API with Llama 3 model
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: 'llama-3.3-70b-versatile', // Groq's fastest free model
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.3, // Lower temperature = more precise outputs
                response_format: { type: 'json_object' }
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        // Extract Groq's response text
        const rawText = response.data.choices[0].message.content;

        // Clean up any markdown formatting
        const cleaned = rawText.replace(/```json|```/g, '').trim();

        // Parse into JSON
        const result = JSON.parse(cleaned);

        // Send telemetry to Splunk silently in background
        logToSplunk('log_onboarded', {
            sourcetype: result.sourcetype,
            extracted_fields: result.description
        });

        // Send back to frontend
        res.json(result);

    } catch (error) {
        // Log the full error and notify frontend
        console.error('Error calling Groq API:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to analyze log sample' });
    }
});

// Route to deploy props.conf natively to Splunk
router.post('/deploy', async (req, res) => {
    try {
        const { sourcetype, props_conf } = req.body;
        if (!sourcetype || !props_conf) {
            return res.status(400).json({ error: "Missing sourcetype or props_conf" });
        }

        const splunkUrl = req.splunk.url;
        const splunkAuth = req.splunk.authHeader;
        const httpsAgent = new (require('https').Agent)({ rejectUnauthorized: false });

        const headers = {
            'Authorization': splunkAuth,
            'Content-Type': 'application/x-www-form-urlencoded'
        };

        const data = new URLSearchParams();
        data.append('name', sourcetype);

        // Parse the raw INI text into key-value pairs for the Splunk API
        const lines = props_conf.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('[') || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx > -1) {
                const key = trimmed.substring(0, eqIdx).trim();
                const val = trimmed.substring(eqIdx + 1).trim();
                data.append(key, val);
            }
        }

        // Deploy to nobody/search/configs/conf-props
        const endpoint = `${splunkUrl}/servicesNS/nobody/search/configs/conf-props?output_mode=json`;
        
        try {
            await axios.post(endpoint, data, { headers, httpsAgent });
        } catch (splunkErr) {
            if (splunkErr.response && splunkErr.response.status === 409) {
                // If it already exists, update it by posting to the specific sourcetype endpoint
                const updateEndpoint = `${splunkUrl}/servicesNS/nobody/search/configs/conf-props/${encodeURIComponent(sourcetype)}?output_mode=json`;
                data.delete('name'); // Name is in the URL path now
                await axios.post(updateEndpoint, data, { headers, httpsAgent });
            } else {
                throw splunkErr;
            }
        }

        logToSplunk('agent_deployed_props_conf', { sourcetype });
        res.json({ success: true, message: `Successfully injected ${sourcetype} into props.conf natively!` });

    } catch (error) {
        console.error("Props Deploy Error:", error.message);
        res.status(500).json({ error: error.response?.data || error.message });
    }
});

module.exports = router;