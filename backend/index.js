
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const queryRoutes = require('./routes/query');
const copilotRoutes = require('./routes/copilot');
const workspaceRoutes = require('./routes/workspace');
const migrateRoutes = require('./routes/migrate');
const splunkRoutes = require('./routes/splunk');
const onboardRoutes = require('./routes/onboard');
const agentRoutes = require('./routes/agent');
const optimizerRoutes = require('./routes/optimizer');
const cimRoutes = require('./routes/cim');

app.use('/api/query', queryRoutes);
app.use('/api/copilot', copilotRoutes);
app.use('/api/workspace', workspaceRoutes);
app.use('/api/migrate', migrateRoutes);
app.use('/api/splunk', splunkRoutes);
app.use('/api/onboard', onboardRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/optimizer', optimizerRoutes);
app.use('/api/cim', cimRoutes);

app.get('/', (req, res) => {
    res.json({ status: 'Splunk Dev Companion backend is running' });
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
});
