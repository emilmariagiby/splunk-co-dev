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

/**
 * Recursively walks a directory and returns all matching file paths.
 * Skips node_modules, .git, and other irrelevant dirs.
 * Limits total files to 500 to prevent memory issues.
 */
function walkDir(dirPath, results = [], depth = 0) {
    if (depth > 8 || results.length > 500) return results;

    let entries;
    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
        return results;
    }

    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (!shouldSkipDir(entry.name)) {
                walkDir(path.join(dirPath, entry.name), results, depth + 1);
            }
        } else if (entry.isFile() && isAllowedFile(entry.name)) {
            results.push(path.join(dirPath, entry.name));
        }
    }

    return results;
}

/**
 * Extracts log-relevant lines from a file.
 * Returns max 20 lines per file to keep context concise.
 */
function extractLogLines(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
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
// Accepts a folder path, scans it, saves context to workspace.json
router.post('/scan', (req, res) => {
    let { folderPath } = req.body;

    if (!folderPath) {
        return res.status(400).json({ error: 'No folder path provided' });
    }

    // Windows "Copy as path" includes quotes, strip them
    folderPath = folderPath.replace(/^["']|["']$/g, '').trim();

    // Validate path exists and is a directory
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
        return res.status(400).json({ error: `Path not found or not a directory: ${folderPath}` });
    }

    try {
        const startTime = Date.now();

        // Walk the directory
        const allFiles = walkDir(folderPath);

        // Extract log lines from each file
        const fileResults = [];
        let totalLogLines = 0;

        for (const filePath of allFiles) {
            const logLines = extractLogLines(filePath);
            if (logLines.length > 0) {
                fileResults.push({
                    file: path.relative(folderPath, filePath).replace(/\\/g, '/'),
                    logLines
                });
                totalLogLines += logLines.length;
            }
        }

        const scanDuration = Date.now() - startTime;

        // Build the workspace context object
        const workspace = {
            folderPath,
            folderName: path.basename(folderPath),
            scannedAt: new Date().toISOString(),
            totalFiles: allFiles.length,
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
