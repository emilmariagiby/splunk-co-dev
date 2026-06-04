const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');
const { logToSplunk } = require('../services/splunkHEC');
require('dotenv').config();

// Splunk uses a self-signed certificate locally
const agent = new https.Agent({ rejectUnauthorized: false });

/**
 * Calculates a 0–100 efficiency score from Splunk job metrics.
 * Lower = worse (expensive). Higher = better (optimized).
 */
function calcEfficiencyScore(metrics) {
    let score = 100;

    // Penalise for low event-to-scan ratio (scanning a lot, getting little)
    if (metrics.scanCount > 0) {
        const ratio = metrics.eventCount / metrics.scanCount;
        if (ratio < 0.01)       score -= 35; // scanning 100x what you need
        else if (ratio < 0.05)  score -= 25;
        else if (ratio < 0.20)  score -= 15;
        else if (ratio < 0.50)  score -= 5;
    }

    // Penalise for slow execution
    const duration = parseFloat(metrics.runDuration) || 0;
    if (duration > 30)      score -= 30;
    else if (duration > 10) score -= 20;
    else if (duration > 5)  score -= 10;
    else if (duration > 2)  score -= 5;

    // Penalise for large disk usage (MB)
    const diskMB = (metrics.diskUsage || 0) / (1024 * 1024);
    if (diskMB > 500)       score -= 20;
    else if (diskMB > 100)  score -= 10;
    else if (diskMB > 10)   score -= 5;

    // Penalise for scanning everything (no index filter)
    if (metrics.scanCount > 1_000_000) score -= 15;
    else if (metrics.scanCount > 100_000) score -= 8;

    return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Returns a performance tier label based on score.
 */
function scoreTier(score) {
    if (score >= 90) return { tier: 'Excellent', color: 'emerald' };
    if (score >= 75) return { tier: 'Good',      color: 'green' };
    if (score >= 55) return { tier: 'Fair',      color: 'yellow' };
    if (score >= 35) return { tier: 'Poor',      color: 'orange' };
    return                  { tier: 'Critical',  color: 'red' };
}

/**
 * Generates human-readable performance recommendations based on metrics.
 */
function buildRecommendations(metrics, score) {
    const recs = [];
    const duration = parseFloat(metrics.runDuration) || 0;

    if (metrics.scanCount > 0) {
        const ratio = metrics.eventCount / metrics.scanCount;
        if (ratio < 0.05) {
            recs.push({
                type: 'filter',
                message: `Only ${(ratio * 100).toFixed(1)}% of scanned events matched. Add more filters (sourcetype, host, or field values) to reduce scan scope.`
            });
        }
    }

    if (duration > 5) {
        recs.push({
            type: 'time',
            message: `Query took ${duration.toFixed(1)}s. Add a time filter (earliest=-1h) to limit the search window.`
        });
    }

    if (metrics.scanCount > 500_000) {
        recs.push({
            type: 'index',
            message: `${metrics.scanCount.toLocaleString()} events scanned. Consider a more specific index or sourcetype to reduce scan volume.`
        });
    }

    if (score < 60 && metrics.eventCount > 0) {
        recs.push({
            type: 'stats',
            message: 'Consider adding | head 1000 during development to limit result set and speed up iteration.'
        });
    }

    if (recs.length === 0) {
        recs.push({ type: 'ok', message: 'Query is well-optimized. No major changes needed.' });
    }

    return recs;
}

// ── Main route ────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {

    const { query } = req.body;

    if (!query) {
        return res.status(400).json({ error: 'No query provided' });
    }

    const startTime = Date.now();

    try {
        // ── Step 1: Create search job ─────────────────────────────────────────
        const jobResponse = await axios.post(
            `https://${process.env.SPLUNK_HOST}:${process.env.SPLUNK_PORT}/services/search/jobs`,
            `search=${encodeURIComponent('search ' + query)}&output_mode=json`,
            {
                httpsAgent: agent,
                auth: {
                    username: process.env.SPLUNK_USERNAME,
                    password: process.env.SPLUNK_PASSWORD
                },
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }
        );

        const sid = jobResponse.data.sid;
        console.log('[Splunk] Job created:', sid);

        // ── Step 2: Poll until done, capturing status data ────────────────────
        let isDone = false;
        let attempts = 0;
        let jobContent = null;

        while (!isDone && attempts < 20) {
            await new Promise(resolve => setTimeout(resolve, 1000));

            const statusResponse = await axios.get(
                `https://${process.env.SPLUNK_HOST}:${process.env.SPLUNK_PORT}/services/search/jobs/${sid}?output_mode=json`,
                {
                    httpsAgent: agent,
                    auth: {
                        username: process.env.SPLUNK_USERNAME,
                        password: process.env.SPLUNK_PASSWORD
                    }
                }
            );

            jobContent = statusResponse.data.entry[0].content;
            isDone = jobContent.isDone;
            attempts++;
        }

        // If we timed out, kill the job on the Splunk side to save resources
        if (!isDone) {
            console.log('[Splunk] Job timed out, cancelling:', sid);
            try {
                await axios.delete(
                    `https://${process.env.SPLUNK_HOST}:${process.env.SPLUNK_PORT}/services/search/jobs/${sid}`,
                    {
                        httpsAgent: agent,
                        auth: { username: process.env.SPLUNK_USERNAME, password: process.env.SPLUNK_PASSWORD }
                    }
                );
            } catch (e) {
                console.error('[Splunk] Failed to cancel job:', e.message);
            }
            return res.status(408).json({ error: 'Search took too long (>20s). The job was cancelled.' });
        }

        // ── Step 3: Fetch results ─────────────────────────────────────────────
        const resultsResponse = await axios.get(
            `https://${process.env.SPLUNK_HOST}:${process.env.SPLUNK_PORT}/services/search/jobs/${sid}/results?output_mode=json&count=20`,
            {
                httpsAgent: agent,
                auth: {
                    username: process.env.SPLUNK_USERNAME,
                    password: process.env.SPLUNK_PASSWORD
                }
            }
        );

        const results = resultsResponse.data.results;
        const fields = resultsResponse.data.fields;
        const wallTime = ((Date.now() - startTime) / 1000).toFixed(2);

        // ── Step 4: Build Performance Metrics ────────────────────────────────
        // Extract all the good stuff from the job status that we were ignoring before
        const metrics = {
            scanCount:      jobContent?.scanCount       || 0,
            eventCount:     jobContent?.eventCount      || 0,
            resultCount:    jobContent?.resultCount     || results.length,
            runDuration:    jobContent?.runDuration     || 0,
            diskUsage:      jobContent?.diskUsage       || 0,
            dropCount:      jobContent?.dropCount       || 0,
            sid,
            wallTimeSeconds: parseFloat(wallTime),
        };

        const efficiencyScore = calcEfficiencyScore(metrics);
        const { tier, color } = scoreTier(efficiencyScore);
        const recommendations = buildRecommendations(metrics, efficiencyScore);

        // ── Step 5: Log to Splunk (HEC) ───────────────────────────────────────
        logToSplunk('query_executed', {
            query,
            sid,
            scan_count:       metrics.scanCount,
            event_count:      metrics.eventCount,
            result_count:     metrics.resultCount,
            run_duration:     metrics.runDuration,
            efficiency_score: efficiencyScore,
            performance_tier: tier,
            wall_time_seconds: metrics.wallTimeSeconds,
        });

        // ── Return everything ─────────────────────────────────────────────────
        res.json({
            results,
            fields,
            total: results.length,
            performance: {
                metrics,
                efficiencyScore,
                tier,
                color,
                recommendations,
            }
        });

    } catch (error) {
        console.error('[Splunk] API error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to run query in Splunk' });
    }
});

module.exports = router;