const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');
const { logToSplunk } = require('../services/splunkHEC');
require('dotenv').config();

// Create an HTTPS agent that ignores self-signed certificate errors (common in Splunk)
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

// Use the Accurate Model to ensure perfect JSON generation
const ACCURATE_MODEL = 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

router.post('/deploy', async (req, res) => {
    // Set headers for Server-Sent Events
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const { rawInput } = req.body;

    if (!rawInput) {
        sseWrite(res, 'error', { message: 'No input provided' });
        return res.end();
    }

    try {
        // Step 1: AI Parsing
        sseWrite(res, 'info', { message: 'Analyzing input with AI to generate Alert and Dashboard configurations...' });

        const prompt = `
You are an expert Splunk architect. A user has provided a raw input containing SPL queries.
Your job is to parse this input and generate Splunk Alert and Dashboard configurations.

CRITICAL: You must return ONLY valid JSON. Do not include markdown formatting or conversational text.

Example Input:
"Make an alert for 404 errors every 5 mins: index=web status=404. Also make a dashboard called Web Traffic with a timechart of 200s. And make a report for weekly sales: index=sales | timechart sum(price)"

Example Output:
{
  "alerts": [
    {
      "name": "Web 404 Error Monitor",
      "search": "index=web status=404",
      "cron_schedule": "*/5 * * * *",
      "description": "Monitors web index for 404 not found errors.",
      "app": "search",
      "owner": "admin",
      "sharing": "app"
    }
  ],
  "reports": [
    {
      "name": "Weekly Sales Report",
      "search": "index=sales | timechart sum(price)",
      "description": "Tracks total sales revenue over time.",
      "app": "sales_app",
      "owner": "admin",
      "sharing": "global"
    }
  ],
  "dashboards": [
    {
      "title": "Web Traffic",
      "app": "search",
      "owner": "admin",
      "sharing": "app",
      "panels": [
        {
          "title": "Successful Requests",
          "query": "index=web status=200 | timechart count",
          "type": "chart"
        }
      ]
    }
  ]
}

Raw Input to process:
"""
${rawInput}
"""

Generate the JSON payload following the exact schema shown in the Example Output:
`;

        const aiResponse = await axios.post(
            GROQ_URL,
            {
                model: 'llama-3.1-8b-instant',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.2
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        let parsedData;
        try {
            const rawText = aiResponse.data.choices[0].message.content;
            // Extract everything from the first '{' to the last '}'
            const jsonMatch = rawText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error("No JSON found in response");
            parsedData = JSON.parse(jsonMatch[0]);
        } catch (e) {
            console.error("JSON Parse Error:", e.message);
            sseWrite(res, 'error', { message: 'Failed to parse AI response into valid JSON.' });
            return res.end();
        }

        const splunkHost = `https://${process.env.SPLUNK_HOST}:${process.env.SPLUNK_PORT}`;
        const splunkUser = encodeURIComponent(process.env.SPLUNK_USERNAME);
        const splunkAuth = Buffer.from(`${process.env.SPLUNK_USERNAME}:${process.env.SPLUNK_PASSWORD}`).toString('base64');
        const headers = {
            'Authorization': `Basic ${splunkAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        };

        // Step 2: Deploy Alerts
        if (parsedData.alerts && parsedData.alerts.length > 0) {
            sseWrite(res, 'info', { message: `Deploying ${parsedData.alerts.length} alerts to Splunk...` });
            for (const alert of parsedData.alerts) {
                try {
                    const data = new URLSearchParams();
                    data.append('name', alert.name);
                    data.append('search', alert.search);
                    data.append('cron_schedule', alert.cron_schedule || '0 0 * * *');
                    data.append('description', alert.description || '');
                    data.append('is_scheduled', '1');
                    data.append('alert_type', 'always');
                    data.append('alert.severity', '3'); // Medium
                    data.append('alert.track', '1'); // Forces Splunk to classify this as an Alert in the UI

                    const targetApp = alert.app || 'search';
                    const targetOwner = alert.owner || splunkUser;

                    try {
                        await axios.post(`${splunkHost}/servicesNS/${targetOwner}/${targetApp}/saved/searches?output_mode=json`, data, { headers, httpsAgent });
                    } catch (createErr) {
                        if (createErr.response && (createErr.response.status === 409 || extractSplunkError(createErr).includes('overwrite'))) {
                            sseWrite(res, 'info', { message: `Alert '${alert.name}' exists. Overwriting...` });
                            await axios.post(`${splunkHost}/servicesNS/${targetOwner}/${targetApp}/saved/searches/${encodeURIComponent(alert.name)}?output_mode=json`, data, { headers, httpsAgent });
                        } else {
                            throw createErr;
                        }
                    }
                    
                    if (alert.sharing) {
                        const aclData = new URLSearchParams();
                        aclData.append('sharing', alert.sharing);
                        aclData.append('owner', targetOwner);
                        await axios.post(`${splunkHost}/servicesNS/${targetOwner}/${targetApp}/saved/searches/${encodeURIComponent(alert.name)}/acl?output_mode=json`, aclData, { headers, httpsAgent });
                    }
                    
                    sseWrite(res, 'alert_success', alert);
                    
                    logToSplunk('agent_deployed_alert', { name: alert.name, query: alert.search });
                } catch (err) {
                    sseWrite(res, 'alert_error', { name: alert.name, error: extractSplunkError(err) });
                }
            }
        }

        // Step 3: Deploy Reports
        if (parsedData.reports && Array.isArray(parsedData.reports)) {
            sseWrite(res, 'info', { message: `Deploying ${parsedData.reports.length} reports to Splunk...` });
            for (const report of parsedData.reports) {
                try {
                    const data = new URLSearchParams();
                    data.append('name', report.name);
                    data.append('search', report.search);
                    data.append('description', report.description || '');

                    const targetApp = report.app || 'search';
                    const targetOwner = report.owner || splunkUser;

                    try {
                        await axios.post(`${splunkHost}/servicesNS/${targetOwner}/${targetApp}/saved/searches?output_mode=json`, data, { headers, httpsAgent });
                    } catch (createErr) {
                        if (createErr.response && (createErr.response.status === 409 || extractSplunkError(createErr).includes('overwrite'))) {
                            sseWrite(res, 'info', { message: `Report '${report.name}' exists. Overwriting...` });
                            await axios.post(`${splunkHost}/servicesNS/${targetOwner}/${targetApp}/saved/searches/${encodeURIComponent(report.name)}?output_mode=json`, data, { headers, httpsAgent });
                        } else {
                            throw createErr;
                        }
                    }
                    
                    if (report.sharing) {
                        const aclData = new URLSearchParams();
                        aclData.append('sharing', report.sharing);
                        aclData.append('owner', targetOwner);
                        await axios.post(`${splunkHost}/servicesNS/${targetOwner}/${targetApp}/saved/searches/${encodeURIComponent(report.name)}/acl?output_mode=json`, aclData, { headers, httpsAgent });
                    }

                    sseWrite(res, 'report_success', report);
                    
                    logToSplunk('agent_deployed_report', { name: report.name, query: report.search });
                } catch (err) {
                    sseWrite(res, 'report_error', { name: report.name, error: extractSplunkError(err) });
                }
            }
        }

        // Step 4: Deploy Dashboards
        if (parsedData.dashboards && Array.isArray(parsedData.dashboards)) {
            sseWrite(res, 'info', { message: `Deploying ${parsedData.dashboards.length} dashboards to Splunk...` });
            for (const dash of parsedData.dashboards) {
                try {
                    const dashboardId = dash.title.toLowerCase().replace(/[^a-z0-9]+/g, '_');
                    
                    // Generate Simple XML
                    let xml = `<dashboard version="1.1">\n  <label>${dash.title}</label>\n  <row>\n`;
                    dash.panels.forEach((panel) => {
                        xml += `    <panel>\n      <title>${panel.title}</title>\n      <${panel.type}>\n        <search>\n          <query><![CDATA[${panel.query}]]></query>\n          <earliest>-24h@h</earliest>\n          <latest>now</latest>\n        </search>\n      </${panel.type}>\n    </panel>\n`;
                    });
                    xml += `  </row>\n</dashboard>`;

                    const data = new URLSearchParams();
                    data.append('name', dashboardId);
                    data.append('eai:data', xml);

                    const targetApp = dash.app || 'search';
                    const targetOwner = dash.owner || splunkUser;

                    try {
                        await axios.post(`${splunkHost}/servicesNS/${targetOwner}/${targetApp}/data/ui/views?output_mode=json`, data, { headers, httpsAgent });
                    } catch (createErr) {
                        if (createErr.response && (createErr.response.status === 409 || extractSplunkError(createErr).includes('overwrite'))) {
                            sseWrite(res, 'info', { message: `Dashboard '${dash.title}' exists. Overwriting...` });
                            const updateData = new URLSearchParams();
                            updateData.append('eai:data', xml);
                            await axios.post(`${splunkHost}/servicesNS/${targetOwner}/${targetApp}/data/ui/views/${encodeURIComponent(dashboardId)}?output_mode=json`, updateData, { headers, httpsAgent });
                        } else {
                            throw createErr;
                        }
                    }
                    
                    if (dash.sharing) {
                        const aclData = new URLSearchParams();
                        aclData.append('sharing', dash.sharing);
                        aclData.append('owner', targetOwner);
                        await axios.post(`${splunkHost}/servicesNS/${targetOwner}/${targetApp}/data/ui/views/${encodeURIComponent(dashboardId)}/acl?output_mode=json`, aclData, { headers, httpsAgent });
                    }

                    sseWrite(res, 'dash_success', dash);
                    
                    logToSplunk('agent_deployed_dashboard', { name: dash.title });
                } catch (err) {
                    sseWrite(res, 'dash_error', { name: dash.title, error: extractSplunkError(err) });
                }
            }
        }

        sseWrite(res, 'done', { message: 'All deployments completed successfully.' });
        res.end();

    } catch (error) {
        console.error('Agent Error:', error.response?.data || error.message);
        sseWrite(res, 'error', { message: 'An unexpected error occurred during deployment.' });
        res.end();
    }
});

module.exports = router;
