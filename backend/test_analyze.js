const axios = require('axios');
require('dotenv').config();

async function testAnalyze() {
    const url = 'http://localhost:3002/api/copilot/analyze';
    const payload = {
        message: 'Analyze the following live Splunk search results. Results (first 10 rows): [{"status":"200","count":"54"},{"status":"404","count":"12"}]'
    };

    console.log('Sending POST to', url);
    try {
        const response = await axios.post(url, payload, { responseType: 'stream' });
        console.log('Response status:', response.status);

        response.data.on('data', (chunk) => {
            console.log('CHUNK RECEIVED:', chunk.toString());
        });

        response.data.on('end', () => {
            console.log('Stream finished.');
        });
    } catch (err) {
        console.error('Error:', err.message);
        if (err.response) {
            console.error('Response data:', err.response.data);
        }
    }
}

testAnalyze();
