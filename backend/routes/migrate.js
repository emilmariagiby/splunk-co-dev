const express = require('express');
const router = express.Router();
const axios = require('axios');
const { logToSplunk } = require('../services/splunkHEC');
require('dotenv').config();

// This route receives an SPL1 query and converts it to SPL2
router.post('/', async (req, res) => {
    const { query } = req.body;

    if (!query) {
        return res.status(400).json({ error: 'No query provided' });
    }

    try {
        const prompt = `
      You are an expert in Splunk SPL (Search Processing Language) and specifically the transition from SPL1 to the modern SPL2 syntax.
      A user has written the following SPL1 query:
      
      "${query}"
      
      Please convert this query into the new SPL2 syntax. 
      Ensure the translation is syntactically correct for SPL2.
      Also provide a brief explanation of the syntax changes made.
      
      Respond in this exact JSON format with no markdown or backticks:
      {
        "original": "the original SPL1 query",
        "spl2": "the converted SPL2 query",
        "explanation": "brief explanation of what changed in SPL2"
      }
    `;

        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: 'llama-3.3-70b-versatile',
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.1, // Keep it very precise for syntax migration
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

        // Send telemetry to Splunk silently in background
        logToSplunk('query_migrated', {
            spl1_query: query,
            spl2_query: result.spl2
        });

        res.json(result);

    } catch (error) {
        console.error('Error calling Groq API for migration:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to migrate query to SPL2' });
    }
});

module.exports = router;
