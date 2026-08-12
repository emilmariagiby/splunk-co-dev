const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { logToSplunk } = require('../services/splunkHEC');

const crypto = require('crypto');

const getUserHash = (req) => {
    if (!req || !req.splunk) return 'default';
    return crypto.createHash('md5').update(`${req.splunk.url}-${req.splunk.username}`).digest('hex');
};

const getWorkspaceFile = (req) => {
    return path.join(__dirname, `../data/workspace_${getUserHash(req)}.json`);
};

// ── File types and patterns to scan ──────────────────────────────────────────

const ALLOWED_EXTENSIONS = ['.js', '.ts', '.py', '.java', '.go', '.rb', '.php', '.conf', '.json', '.yaml', '.yml', '.env.example', '.sh'];

// Patterns that indicate logging — lines we extract for Copilot context
const LOG_PATTERNS = [
    /console\.(log|warn|error|info|debug)\s*\(/i,
    /logger\.(info|warn|error|debug|fatal|trace)\s*\(/i,
    /log\.(info|warn|error|debug|fatal)\s*\(/i,
    /logging\.(info|warn|error|debug)\s*\(/i,
    /winston\./i,
    /bunyan\./i,
    /pino\./i,
    /log4j\./i,
    /slf4j\./i,
    /print(f|ln)?\s*\(/i,         // Python print
    /fmt\.(Print|Println|Printf)/i, // Go
    /\bHEC\b/i,
    /\bsourcetype\b/i,
    /\bsplunk\b/i,
    /\.write\s*\(/i,              // generic file writes
];

// Directories to always skip
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '__pycache__', 'dist', 'build', 'coverage', '.cache', 'vendor', 'venv', '.venv']);

// ── Helpers ───────────────────────────────────────────────────────────────────

function shouldSkipDir(dirName) {
    return SKIP_DIRS.has(dirName) || dirName.startsWith('.');
}

function isAllowedFile(filename) {
    return ALLOWED_EXTENSIONS.some(ext => filename.endsWith(ext));
}

function isLogLine(line) {
    return LOG_PATTERNS.some(p => p.test(line));
}

// Local file walking removed for cloud compatibility

/**
 * Extracts log-relevant lines from a file's content.
 * Returns max 20 lines per file to keep context concise.
 */
function extractLogLines(content) {
    try {
        const lines = content.split('\n');
        const extracted = [];

        for (let i = 0; i < lines.length && extracted.length < 20; i++) {
            const line = lines[i].trim();
            if (line && isLogLine(line)) {
                extracted.push({
                    line: i + 1,
                    code: line.substring(0, 200) // trim very long lines
                });
            }
        }

        return extracted;
    } catch {
        return [];
    }
}

// ── Helpers for reading/writing workspace.json ────────────────────────────────

const readWorkspace = (req) => {
    try {
        return JSON.parse(fs.readFileSync(getWorkspaceFile(req), 'utf8'));
    } catch {
        return null;
    }
};

const writeWorkspace = (req, data) => {
    const file = getWorkspaceFile(req);
    if (!data) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
    } else {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    }
};

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/workspace/scan
// Accepts a JSON payload of files, extracts log patterns, saves context to workspace.json
router.post('/scan', (req, res) => {
    let { folderName, files } = req.body;

    if (!files || !Array.isArray(files)) {
        return res.status(400).json({ error: 'No files provided' });
    }

    try {
        const startTime = Date.now();

        // Extract log lines from each file
        const fileResults = [];
        let totalLogLines = 0;

        for (const fileObj of files) {
            if (!fileObj.path || !fileObj.content) continue;
            
            const logLines = extractLogLines(fileObj.content);
            if (logLines.length > 0) {
                fileResults.push({
                    file: fileObj.path,
                    logLines
                });
                totalLogLines += logLines.length;
            }
        }

        const scanDuration = Date.now() - startTime;

        // Build the workspace context object
        const workspace = {
            folderPath: folderName, // Reused as an identifier
            folderName: folderName || 'workspace',
            scannedAt: new Date().toISOString(),
            totalFiles: files.length,
            filesWithLogs: fileResults.length,
            totalLogLines,
            scanDurationMs: scanDuration,
            files: fileResults,
        };

        writeWorkspace(req, workspace);

        // Bust the copilot's in-memory workspace cache so next /suggest
        // call gets fresh data without needing to re-read the file.
        try {
            const { invalidateWorkspaceCache } = require('./copilot');
            invalidateWorkspaceCache(req);
        } catch { /* copilot not loaded yet */ }

        logToSplunk('workspace_scanned', {
            folder: path.basename(folderPath),
            total_files: allFiles.length,
            files_with_logs: fileResults.length,
            total_log_lines: totalLogLines,
        });

        res.json({
            success: true,
            summary: {
                folderName: workspace.folderName,
                totalFiles: workspace.totalFiles,
                filesWithLogs: workspace.filesWithLogs,
                totalLogLines: workspace.totalLogLines,
                scannedAt: workspace.scannedAt,
            }
        });

    } catch (error) {
        console.error('[Workspace] Scan error:', error.message);
        res.status(500).json({ error: 'Failed to scan workspace: ' + error.message });
    }
});

// GET /api/workspace/context
// Returns the current workspace context (used by Copilot to enrich prompts)
router.get('/context', (req, res) => {
    const workspace = readWorkspace(req);
    if (!workspace) {
        return res.json({ connected: false });
    }
    res.json({ connected: true, workspace });
});

// DELETE /api/workspace/disconnect
// Clears the workspace context
router.delete('/disconnect', (req, res) => {
    writeWorkspace(req, null);
    try {
        const { invalidateWorkspaceCache } = require('./copilot');
        invalidateWorkspaceCache(req);
    } catch { /* copilot not loaded yet */ }
    res.json({ success: true });
});

module.exports = router;
module.exports.readWorkspace = readWorkspace; // exported so copilot.js can use it
