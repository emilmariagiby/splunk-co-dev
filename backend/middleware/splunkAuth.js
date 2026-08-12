const getSplunkCreds = (req, res, next) => {
    const host = req.headers['x-splunk-host'] || process.env.SPLUNK_HOST;
    const port = req.headers['x-splunk-port'] || process.env.SPLUNK_PORT || '8089';
    const username = req.headers['x-splunk-username'] || process.env.SPLUNK_USERNAME;
    const password = req.headers['x-splunk-password'] || process.env.SPLUNK_PASSWORD;
    const hecToken = req.headers['x-splunk-hec-token'] || process.env.SPLUNK_HEC_TOKEN;

    if (!host || !username || !password) {
        return res.status(401).json({ error: 'Missing Splunk credentials in headers' });
    }

    req.splunk = {
        host,
        port,
        username,
        password,
        hecToken,
        url: host.startsWith('http') ? host : `https://${host}:${port}`,
        authHeader: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
    };

    next();
};

module.exports = getSplunkCreds;
