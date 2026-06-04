
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const queryRoute = require('./routes/query');
const onboardRoute = require('./routes/onboard');
const splunkRoute = require('./routes/splunk');
const migrateRoute = require('./routes/migrate');
const copilotRoute = require('./routes/copilot');
const workspaceRoute = require('./routes/workspace');

app.use('/api/query', queryRoute);
app.use('/api/onboard', onboardRoute);
app.use('/api/splunk', splunkRoute);
app.use('/api/migrate', migrateRoute);
app.use('/api/copilot', copilotRoute);
app.use('/api/workspace', workspaceRoute);

app.get('/', (req, res) => {
    res.json({ status: 'Splunk Dev Companion backend is running' });
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
});
