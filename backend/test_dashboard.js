const axios = require('axios');
const https = require('https');
require('dotenv').config();

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function testDashboardDeploy() {
    const splunkHost = `https://${process.env.SPLUNK_HOST || 'localhost'}:${process.env.SPLUNK_PORT || '8089'}`;
    const splunkUser = process.env.SPLUNK_USERNAME || 'admin';
    const splunkAuth = Buffer.from(`${splunkUser}:${process.env.SPLUNK_PASSWORD}`).toString('base64');
    const headers = {
        'Authorization': `Basic ${splunkAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
    };

    const dashboardId = "test_trends_dashboard";
    const title = "System Error Trends Dashboard";
    const query = "index=main status=500 | timechart count";

    // 1. Try with invalid type 'line' (which translates to <line> element)
    const xmlInvalid = `<dashboard version="1.1">\n  <label>${title}</label>\n  <row>\n    <panel>\n      <title>500 Errors</title>\n      <line>\n        <search>\n          <query><![CDATA[${query}]]></query>\n          <earliest>-24h@h</earliest>\n          <latest>now</latest>\n        </search>\n      </line>\n    </panel>\n  </row>\n</dashboard>`;

    const dataInvalid = new URLSearchParams();
    dataInvalid.append('name', dashboardId);
    dataInvalid.append('eai:data', xmlInvalid);

    console.log("--- Trying to deploy invalid XML with <line> element ---");
    try {
        const res = await axios.post(`${splunkHost}/servicesNS/${splunkUser}/search/data/ui/views?output_mode=json`, dataInvalid, { headers, httpsAgent });
        console.log("Success:", res.status);
    } catch (err) {
        console.error("Failed as expected:", err.response ? JSON.stringify(err.response.data) : err.message);
    }

    // 2. Try with valid type mapped to 'chart' (translates to <chart> element)
    const xmlValid = `<dashboard version="1.1">\n  <label>${title}</label>\n  <row>\n    <panel>\n      <title>500 Errors</title>\n      <chart>\n        <search>\n          <query><![CDATA[${query}]]></query>\n          <earliest>-24h@h</earliest>\n          <latest>now</latest>\n        </search>\n      </chart>\n    </panel>\n  </row>\n</dashboard>`;

    const dataValid = new URLSearchParams();
    dataValid.append('name', dashboardId);
    dataValid.append('eai:data', xmlValid);

    console.log("\n--- Trying to deploy valid XML with <chart> element ---");
    try {
        const res = await axios.post(`${splunkHost}/servicesNS/${splunkUser}/search/data/ui/views?output_mode=json`, dataValid, { headers, httpsAgent });
        console.log("Success! Status:", res.status);
    } catch (err) {
        console.error("Failed:", err.response ? JSON.stringify(err.response.data) : err.message);
    }
}

testDashboardDeploy();
