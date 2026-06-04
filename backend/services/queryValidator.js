/**
 * Proactive Cost Shield — Query Validator
 *
 * Runs BEFORE the AI call to instantly detect expensive query patterns.
 * Returns a severity score and actionable recommendations.
 *
 * Severity levels:
 *   LOW      — fine, maybe a minor suggestion
 *   MEDIUM   — will work but could be optimized
 *   HIGH     — will be expensive, strongly recommend changes
 *   CRITICAL — block execution, requires user override
 */

// ─── Rule Definitions ────────────────────────────────────────────────────────

const RULES = [
    // ── CRITICAL rules — block execution ─────────────────────────────────────
    {
        id: 'wildcard_index',
        severity: 'CRITICAL',
        label: 'Wildcard Index Scan',
        pattern: /\bindex\s*=\s*\*/i,
        message: 'index=* scans ALL indexes simultaneously. This is the most expensive query you can run — it will consume massive compute resources.',
        fix: 'Replace index=* with a specific index (e.g., index=main or index=security).',
    },
    {
        id: 'no_index',
        severity: 'CRITICAL',
        label: 'No Index Specified',
        // Matches queries that don't start with index= or contain sourcetype= without index=
        pattern: (query) => {
            const trimmed = query.trim().toLowerCase();
            const hasIndex = /\bindex\s*=/.test(trimmed);
            const hasSourcetype = /\bsourcetype\s*=/.test(trimmed);
            const hasInternalCmd = /^\s*(metadata|rest|makeresults|inputlookup)/.test(trimmed);
            return !hasIndex && !hasInternalCmd && !hasSourcetype;
        },
        message: 'No index specified. Without an index filter, Splunk scans all data across all indexes.',
        fix: 'Add an index filter at the start of your query: index=<your_index>',
    },
    {
        id: 'no_time_filter_wildcard',
        severity: 'CRITICAL',
        label: 'No Time Filter on Wildcard',
        pattern: (query) => {
            const hasWildcardIndex = /\bindex\s*=\s*\*/i.test(query);
            const hasTimeFilter = /\b(earliest|latest)\s*=/.test(query);
            return hasWildcardIndex && !hasTimeFilter;
        },
        message: 'Wildcard index with no time filter — will scan all data for all time.',
        fix: 'Add a time filter: earliest=-24h latest=now',
    },

    // ── HIGH rules — strongly warn ────────────────────────────────────────────
    {
        id: 'no_time_filter',
        severity: 'HIGH',
        label: 'No Time Filter',
        pattern: (query) => {
            const hasTimeFilter = /\b(earliest|latest)\s*=/.test(query);
            const hasInternalCmd = /^\s*(metadata|rest|makeresults|inputlookup)/.test(query.trim());
            return !hasTimeFilter && !hasInternalCmd;
        },
        message: 'No time filter detected. Splunk will scan all historical data, which is slow and expensive.',
        fix: 'Add a time range at the start: earliest=-24h latest=now (or use the time picker in Splunk UI).',
    },
    {
        id: 'wildcard_sourcetype',
        severity: 'HIGH',
        label: 'Wildcard Sourcetype',
        pattern: /\bsourcetype\s*=\s*\*/i,
        message: 'sourcetype=* does not filter anything — it scans all source types.',
        fix: 'Specify a sourcetype: sourcetype=access_combined or sourcetype=linux_secure',
    },
    {
        id: 'leading_wildcard_search',
        severity: 'HIGH',
        label: 'Leading Wildcard Search Term',
        pattern: /\|\s*search\s+\*\w+|\bsearch\s+\*\w+/i,
        message: 'A search term beginning with * (e.g., *error) cannot use Bloom filters and will do a full text scan.',
        fix: 'Avoid leading wildcards. Use "error*" instead of "*error" or search for exact terms.',
    },
    {
        id: 'stats_without_filter',
        severity: 'HIGH',
        label: 'Stats on Unfiltered Data',
        pattern: (query) => {
            const hasStats = /\|\s*stats\b/i.test(query);
            const hasWhere = /\|\s*(where|search)\b/i.test(query);
            const hasSourcetype = /\bsourcetype\s*=\s*(?!\*)\S+/.test(query);
            const hasIndex = /\bindex\s*=\s*(?!\*)\S+/.test(query);
            return hasStats && !hasWhere && !hasSourcetype && !hasIndex;
        },
        message: '| stats is running on unfiltered data. This will aggregate everything in the index.',
        fix: 'Add a filter before stats: | search status=error | stats count by host',
    },

    // ── MEDIUM rules — optimization suggestions ───────────────────────────────
    {
        id: 'index_star_internal',
        severity: 'MEDIUM',
        label: 'Querying _internal at Scale',
        pattern: /\bindex\s*=\s*_internal\b/i,
        message: 'index=_internal can be large. Without tight filters it may be slow.',
        fix: 'Filter by component or source: index=_internal sourcetype=splunkd component=SearchOperator',
    },
    {
        id: 'head_missing',
        severity: 'MEDIUM',
        label: 'No Result Limit',
        pattern: (query) => {
            const hasHead = /\|\s*head\b/i.test(query);
            const hasLimit = /\|\s*stats\b/i.test(query); // stats naturally limits
            const hasTimechart = /\|\s*timechart\b/i.test(query);
            return !hasHead && !hasLimit && !hasTimechart;
        },
        message: 'No | head command to limit results. Large result sets slow down rendering.',
        fix: 'Add | head 1000 at the end to limit results during development.',
    },
    {
        id: 'regex_heavy',
        severity: 'MEDIUM',
        label: 'Heavy Regex Extraction',
        pattern: /\|\s*rex\s+field=/i,
        message: '| rex with field= runs regex on every event. This is CPU-intensive.',
        fix: 'Consider using EXTRACT-* in props.conf for field extractions at index time instead.',
    },
    {
        id: 'eval_in_search',
        severity: 'MEDIUM',
        label: 'Eval Before Filter',
        pattern: (query) => {
            const evalPos = query.search(/\|\s*eval\b/i);
            const wherePos = query.search(/\|\s*where\b/i);
            return evalPos !== -1 && wherePos !== -1 && evalPos < wherePos;
        },
        message: '| eval is running before | where. This evaluates all events before filtering.',
        fix: 'Move your | where filter before | eval to reduce the number of events processed.',
    },

    // ── LOW rules — minor notes ───────────────────────────────────────────────
    {
        id: 'table_all_fields',
        severity: 'LOW',
        label: 'Table with Many Fields',
        pattern: /\|\s*table\s+\*/i,
        message: '| table * returns all fields, which increases data transfer.',
        fix: 'Specify only the fields you need: | table _time, host, status',
    },
    {
        id: 'sort_no_limit',
        severity: 'LOW',
        label: 'Sort Without Limit',
        pattern: (query) => {
            const hasSort = /\|\s*sort\b/i.test(query);
            const hasLimit = /\|\s*(head|limit)\b/i.test(query);
            return hasSort && !hasLimit;
        },
        message: '| sort without a preceding | head can sort very large result sets.',
        fix: 'Pair sort with a limit: | sort -count | head 100',
    },
];

// ─── Severity Priority Order ──────────────────────────────────────────────────

const SEVERITY_ORDER = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

// ─── Main Validator Function ──────────────────────────────────────────────────

/**
 * Validates a raw SPL query against all rules.
 *
 * @param {string} query - The raw SPL query string
 * @returns {{
 *   severity: 'SAFE'|'LOW'|'MEDIUM'|'HIGH'|'CRITICAL',
 *   isBlocked: boolean,
 *   violations: Array<{ id, severity, label, message, fix }>,
 *   summary: string
 * }}
 */
function validateQuery(query) {
    if (!query || typeof query !== 'string') {
        return { severity: 'SAFE', isBlocked: false, violations: [], summary: 'No query provided.' };
    }

    const violations = [];

    for (const rule of RULES) {
        let matched = false;

        if (typeof rule.pattern === 'function') {
            matched = rule.pattern(query);
        } else {
            matched = rule.pattern.test(query);
        }

        if (matched) {
            violations.push({
                id: rule.id,
                severity: rule.severity,
                label: rule.label,
                message: rule.message,
                fix: rule.fix,
            });
        }
    }

    // Sort violations by severity (worst first)
    violations.sort((a, b) => (SEVERITY_ORDER[b.severity] || 0) - (SEVERITY_ORDER[a.severity] || 0));

    // Overall severity = worst violation found
    const worstSeverity = violations.length > 0 ? violations[0].severity : 'SAFE';
    const isBlocked = worstSeverity === 'CRITICAL';

    // Human-readable summary
    const criticalCount = violations.filter(v => v.severity === 'CRITICAL').length;
    const highCount = violations.filter(v => v.severity === 'HIGH').length;
    const mediumCount = violations.filter(v => v.severity === 'MEDIUM').length;
    const lowCount = violations.filter(v => v.severity === 'LOW').length;

    let summary = 'Query looks safe.';
    if (isBlocked) {
        summary = `BLOCKED: ${criticalCount} critical issue${criticalCount > 1 ? 's' : ''} detected. This query will be extremely expensive to run.`;
    } else if (worstSeverity === 'HIGH') {
        summary = `${highCount} high-cost pattern${highCount > 1 ? 's' : ''} detected. This query may be slow or expensive.`;
    } else if (worstSeverity === 'MEDIUM') {
        summary = `${mediumCount} optimization opportunit${mediumCount > 1 ? 'ies' : 'y'} found.`;
    } else if (worstSeverity === 'LOW') {
        summary = `${lowCount} minor suggestion${lowCount > 1 ? 's' : ''} available.`;
    }

    return { severity: worstSeverity, isBlocked, violations, summary };
}

module.exports = { validateQuery };
