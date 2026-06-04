const axios = require('axios');
const https = require('https');
require('dotenv').config();

// HEC requires SSL validation to be bypassed for local environments
const agent = new https.Agent({ rejectUnauthorized: false });

/**
 * Sends a log event to Splunk via HTTP Event Collector (HEC)
 * 
 * @param {string} eventName - Short description of the event (e.g., 'query_analyzed', 'log_onboarded')
 * @param {object} eventData - JSON object containing the context of the event
 */
const logToSplunk = async (eventName, eventData) => {
    // If HEC token isn't configured yet, silently skip logging
    if (!process.env.SPLUNK_HEC_TOKEN) {
        return;
    }

    try {
        const payload = {
            event: {
                action: eventName,
                ...eventData
            },
            sourcetype: 'codev_telemetry',
            source: 'codev_backend'
        };

        await axios.post(
            `https://${process.env.SPLUNK_HOST}:8088/services/collector/event`,
            payload,
            {
                httpsAgent: agent,
                headers: {
                    'Authorization': `Splunk ${process.env.SPLUNK_HEC_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        console.log(`[HEC] Successfully logged '${eventName}' to Splunk`);
    } catch (error) {
        console.error(`[HEC ERROR] Failed to log '${eventName}' to Splunk:`, error.message);
    }
};

module.exports = { logToSplunk };
