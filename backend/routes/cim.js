const express = require('express');
const router = express.Router();
const axios = require('axios');
const { logToSplunk } = require('../services/splunkHEC');
require('dotenv').config();

router.post('/', async (req, res) => {
    const { logSample } = req.body;

    if (!logSample) {
        return res.status(400).json({ error: 'No log sample provided' });
    }

    try {
        const prompt = `
        You are an expert Splunk Administrator and Enterprise Security (ES) Architect.
        Your task is to map the fields from the provided raw log to the Splunk Common Information Model (CIM).

        A user has provided the following raw log sample:
        "${logSample}"

        Please analyze this log and provide:
        1. A list of all detected raw field names and their extracted values.
        2. The corresponding official Splunk CIM field names for each detected field.
        3. The exact FIELDALIAS configurations needed for props.conf.

        Respond in this exact JSON format with no markdown or backticks:
        {
          "detected_fields": [
            {
              "raw_field": "source_ip_addr",
              "cim_field": "src",
              "example_value": "192.168.1.5",
              "explanation": "Maps to Network Traffic CIM model."
            }
          ],
          "props_conf_aliases": "FIELDALIAS-src = source_ip_addr AS src\\nFIELDALIAS-dest = dest_ip AS dest",
          "summary": "Brief explanation of which CIM Data Models apply (e.g. Network Traffic, Authentication)."
        }
        `;

        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,
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

        logToSplunk('agent_mapped_cim', { summary: result.summary });

        res.json(result);
    } catch (error) {
        console.error('Error in CIM Mapper:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to generate CIM mapping.' });
    }
});

const { readWorkspace } = require('./workspace');
const fs = require('fs');
const path = require('path');

router.post('/write-conf', async (req, res) => {
    const { props_conf_aliases, sourcetype } = req.body;
    
    if (!props_conf_aliases) {
        return res.status(400).json({ error: 'No aliases provided' });
    }

    const workspace = readWorkspace();
    if (!workspace || !workspace.folderPath) {
        return res.status(400).json({ error: 'No workspace connected. Please connect a workspace in the sidebar first.' });
    }

    try {
        const localDir = path.join(workspace.folderPath, 'local');
        if (!fs.existsSync(localDir)) {
            fs.mkdirSync(localDir, { recursive: true });
        }
        
        const propsPath = path.join(localDir, 'props.conf');
        const st = sourcetype || 'default_sourcetype';

        let existingContent = '';
        if (fs.existsSync(propsPath)) {
            existingContent = fs.readFileSync(propsPath, 'utf8');
        }

        let newContent = '';
        const stanzaHeader = `[${st}]`;
        if (existingContent.includes(stanzaHeader)) {
            newContent = `${existingContent}\n\n[${st}]\n${props_conf_aliases}\n`;
        } else {
            newContent = `${existingContent}${existingContent ? '\n\n' : ''}[${st}]\n${props_conf_aliases}\n`;
        }

        fs.writeFileSync(propsPath, newContent, 'utf8');

        // Log telemetry to HEC
        logToSplunk('cim_config_written', {
            sourcetype: st,
            file_path: propsPath
        });

        res.json({ success: true, message: `Successfully appended aliases to local/props.conf` });
    } catch (err) {
        console.error('Error writing props.conf:', err);
        res.status(500).json({ error: 'Failed to write to props.conf: ' + err.message });
    }
});

module.exports = router;
