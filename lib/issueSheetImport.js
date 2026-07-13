/**
 * Pure helpers for turning the newsroom's contributor-by-month Google Sheet
 * into article-folder import candidates. This module deliberately has no UI,
 * Firebase, or Google client dependencies.
 */

const MONTHS = Object.freeze([
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
]);

const MONTH_ALIASES = Object.freeze({
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    feburary: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11,
});

const STATUS_ALIASES = Object.freeze({
    missing: ['missing', 'msising', 'missng', 'misising', 'not submitted', 'no submission'],
    extension: ['extension', 'extended', 'ext', 'extension granted'],
    exempt: ['exempt', 'excused', 'not assigned'],
    not_applicable: ['n/a', 'na', 'not applicable'],
    withdrawn: ['withdrawn', 'dropped'],
});

const cleanText = (value) => String(value ?? '')
    .replace(/[\u00a0\u200b-\u200d\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const comparisonText = (value) => cleanText(value)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9/]+/g, ' ')
    .trim();

export function extractSpreadsheetId(value) {
    const text = cleanText(value);
    if (!text) return null;
    const urlMatch = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/i);
    if (urlMatch) return urlMatch[1];
    if (/^[a-zA-Z0-9_-]{20,}$/.test(text)) return text;
    return null;
}

export function parseMonthLabel(value) {
    const text = comparisonText(value);
    if (!text) return null;
    const yearMatch = text.match(/\b(20\d{2})\b/);
    const tokens = text.split(/\s+/);
    const monthToken = tokens.find((token) => Object.hasOwn(MONTH_ALIASES, token));
    if (!monthToken) return null;
    const monthIndex = MONTH_ALIASES[monthToken];
    return {
        month: MONTHS[monthIndex],
        monthIndex,
        year: yearMatch ? Number(yearMatch[1]) : null,
        key: `${yearMatch ? yearMatch[1] : 'any'}-${String(monthIndex + 1).padStart(2, '0')}`,
    };
}

export function normalizeMonthLabel(value) {
    return parseMonthLabel(value)?.month || null;
}

function levenshteinDistance(left, right) {
    if (left === right) return 0;
    if (!left.length) return right.length;
    if (!right.length) return left.length;
    let previous = Array.from({length: right.length + 1}, (_, index) => index);
    for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
        const current = [leftIndex + 1];
        for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
            current.push(Math.min(
                current[rightIndex] + 1,
                previous[rightIndex + 1] + 1,
                previous[rightIndex] + (left[leftIndex] === right[rightIndex] ? 0 : 1),
            ));
        }
        previous = current;
    }
    return previous[right.length];
}

/** Classifies administrative literals while avoiding fuzzy matches on arbitrary prose. */
export function classifyIssueCellLiteral(value) {
    const raw = cleanText(value);
    const normalized = comparisonText(raw);
    if (!normalized) return {kind: 'blank', status: 'blank', label: raw};

    for (const [status, aliases] of Object.entries(STATUS_ALIASES)) {
        if (aliases.includes(normalized)) return {kind: 'status', status, label: raw};
    }

    // Only fuzzy-match short, single-word cells against "missing". This catches
    // common transpositions such as "msising" without treating article titles
    // or editorial notes as status values.
    if (/^[a-z]{5,9}$/.test(normalized) && levenshteinDistance(normalized, 'missing') <= 2) {
        return {kind: 'status', status: 'missing', label: raw};
    }

    return {kind: 'literal', status: null, label: raw};
}

function cellText(cell = {}) {
    const value = cell.formattedValue
        ?? cell.effectiveValue?.stringValue
        ?? cell.userEnteredValue?.stringValue
        ?? cell.effectiveValue?.numberValue
        ?? cell.userEnteredValue?.numberValue
        ?? '';
    return cleanText(value);
}

function collectUris(cell = {}) {
    const values = [];
    const add = (value) => {
        const uri = cleanText(value);
        if (uri && !values.includes(uri)) values.push(uri);
    };
    add(cell.hyperlink);
    add(cell.userEnteredFormat?.textFormat?.link?.uri);
    add(cell.effectiveFormat?.textFormat?.link?.uri);
    for (const run of cell.textFormatRuns || []) add(run?.format?.link?.uri);
    for (const run of cell.chipRuns || []) {
        add(run?.chip?.richLinkProperties?.uri);
        add(run?.richLinkProperties?.uri);
    }
    const literalMatches = cellText(cell).match(/https?:\/\/[^\s<>()]+/gi) || [];
    literalMatches.forEach((url) => add(url.replace(/[.,;:!?]+$/, '')));
    return values;
}

export function extractCellUrl(cell = {}) {
    return collectUris(cell)[0] || null;
}

export function extractDriveFileId(value) {
    const url = cleanText(value);
    if (!url) return null;
    const pathMatch = url.match(/\/(?:folders|document\/d|spreadsheets\/d|file\/d|presentation\/d)\/([a-zA-Z0-9_-]+)/i);
    if (pathMatch) return pathMatch[1];
    try {
        const parsed = new URL(url);
        return parsed.searchParams.get('id') || null;
    } catch {
        return null;
    }
}

function extractCellMimeType(cell = {}) {
    for (const run of cell.chipRuns || []) {
        const properties = run?.chip?.richLinkProperties || run?.richLinkProperties;
        const mime = cleanText(properties?.mimeType);
        if (mime) return mime;
    }
    return null;
}

function columnName(index) {
    let value = index + 1;
    let result = '';
    while (value > 0) {
        value -= 1;
        result = String.fromCharCode(65 + (value % 26)) + result;
        value = Math.floor(value / 26);
    }
    return result;
}

function quoteSheetTitle(title) {
    return /^[a-zA-Z0-9_]+$/.test(title) ? title : `'${title.replaceAll("'", "''")}'`;
}

function a1Range(title, rowIndex, columnIndex) {
    return `${quoteSheetTitle(title)}!${columnName(columnIndex)}${rowIndex + 1}`;
}

function locateArticlesSheet(input, requestedTitle) {
    const sheets = Array.isArray(input?.sheets) ? input.sheets : [input];
    const requested = comparisonText(requestedTitle || 'ARTICLES');
    return sheets.find((sheet) => comparisonText(sheet?.properties?.title || sheet?.title) === requested)
        || sheets[0]
        || null;
}

function flattenSheet(sheet) {
    const cells = new Map();
    for (const grid of sheet?.data || []) {
        const startRow = grid.startRow || 0;
        const startColumn = grid.startColumn || 0;
        (grid.rowData || []).forEach((row, rowOffset) => {
            (row.values || []).forEach((cell, columnOffset) => {
                cells.set(`${startRow + rowOffset}:${startColumn + columnOffset}`, cell);
            });
        });
    }
    return cells;
}

/**
 * Parse one month from an ARTICLES matrix.
 *
 * Accepts either a full spreadsheets.get response or one Sheet object. The
 * header row and contributor column are auto-detected but can be overridden.
 */
export function parseIssueSheetMonth(input, options = {}) {
    const selectedMonth = parseMonthLabel(options.month);
    if (!selectedMonth) throw new Error(`Unknown issue month: ${cleanText(options.month) || '(blank)'}`);

    const sheet = locateArticlesSheet(input, options.sheetTitle);
    if (!sheet) throw new Error('The spreadsheet contains no sheets.');
    const sheetTitle = cleanText(sheet?.properties?.title || sheet?.title || options.sheetTitle || 'ARTICLES');
    const cells = flattenSheet(sheet);
    const rowCount = sheet?.properties?.gridProperties?.rowCount || options.rowCount || 1000;
    const columnCount = sheet?.properties?.gridProperties?.columnCount || options.columnCount || 52;

    let header = null;
    if (Number.isInteger(options.headerRowIndex) && Number.isInteger(options.monthColumnIndex)) {
        header = {rowIndex: options.headerRowIndex, columnIndex: options.monthColumnIndex};
    } else {
        const maxRows = Math.min(rowCount, options.headerScanRows || 30);
        for (let rowIndex = 0; rowIndex < maxRows && !header; rowIndex += 1) {
            for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
                const parsed = parseMonthLabel(cellText(cells.get(`${rowIndex}:${columnIndex}`)));
                const yearMatches = !selectedMonth.year || !parsed?.year || selectedMonth.year === parsed.year;
                if (parsed?.monthIndex === selectedMonth.monthIndex && yearMatches) {
                    header = {rowIndex, columnIndex};
                    break;
                }
            }
        }
    }
    if (!header) throw new Error(`${selectedMonth.month} was not found in the ${sheetTitle} sheet.`);

    const contributorColumnIndex = Number.isInteger(options.contributorColumnIndex)
        ? options.contributorColumnIndex
        : 0;
    const candidates = [];
    const exceptions = [];
    const statuses = [];
    const byKey = new Map();

    for (let rowIndex = header.rowIndex + 1; rowIndex < rowCount; rowIndex += 1) {
        const contributor = cellText(cells.get(`${rowIndex}:${contributorColumnIndex}`));
        const cell = cells.get(`${rowIndex}:${header.columnIndex}`) || {};
        const label = cellText(cell);
        const classification = classifyIssueCellLiteral(label);
        const sourceCell = {
            sheetTitle,
            rowIndex,
            columnIndex: header.columnIndex,
            range: a1Range(sheetTitle, rowIndex, header.columnIndex),
        };
        if (classification.kind === 'blank') continue;
        if (classification.kind === 'status') {
            statuses.push({contributor, ...classification, sourceCell});
            continue;
        }

        const url = extractCellUrl(cell);
        if (!url) {
            exceptions.push({
                type: 'needs_link',
                contributor,
                label,
                sourceCell,
                message: 'This cell has text but no link or smart-chip URL.',
            });
            continue;
        }

        const fileId = extractDriveFileId(url);
        const mimeType = extractCellMimeType(cell);
        const key = fileId ? `drive:${fileId}` : `url:${url}`;
        const existing = byKey.get(key);
        if (existing) {
            if (contributor && !existing.contributors.includes(contributor)) existing.contributors.push(contributor);
            existing.sourceCells.push(sourceCell);
            if (label && !existing.labels.includes(label)) existing.labels.push(label);
            continue;
        }
        const candidate = {
            key,
            contributors: contributor ? [contributor] : [],
            contributor,
            label,
            labels: label ? [label] : [],
            url,
            fileId,
            mimeType,
            sourceCells: [sourceCell],
            sourceCell,
            month: selectedMonth.month,
        };
        byKey.set(key, candidate);
        candidates.push(candidate);
    }

    return {
        spreadsheetId: extractSpreadsheetId(input?.spreadsheetUrl) || input?.spreadsheetId || null,
        sheetTitle,
        month: selectedMonth,
        header: {...header, range: a1Range(sheetTitle, header.rowIndex, header.columnIndex)},
        contributorColumnIndex,
        candidates,
        statuses,
        exceptions,
        summary: summarizeIssueSheetImport({candidates, statuses, exceptions}),
    };
}

export function summarizeIssueSheetImport(result = {}) {
    const candidates = Array.isArray(result.candidates) ? result.candidates : [];
    const statuses = Array.isArray(result.statuses) ? result.statuses : [];
    const exceptions = Array.isArray(result.exceptions) ? result.exceptions : [];
    return {
        candidates: candidates.length,
        contributors: new Set(candidates.flatMap((item) => item.contributors || [])).size,
        sharedSubmissions: candidates.filter((item) => (item.contributors || []).length > 1).length,
        needsLink: exceptions.filter((item) => item.type === 'needs_link').length,
        statuses: statuses.reduce((counts, item) => ({
            ...counts,
            [item.status]: (counts[item.status] || 0) + 1,
        }), {}),
    };
}
