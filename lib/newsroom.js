/**
 * Shared newsroom vocabulary and record normalizers.
 *
 * This module intentionally has no Firebase imports. Its output can be passed to
 * the Firebase v9 client SDK, used in API routes, or serialized in getServerSideProps.
 */

export const ARTICLE_STATUSES = Object.freeze({
    IMPORTED: 'imported',
    AI_PREPARED: 'ai_prepared',
    NEEDS_REVIEW: 'needs_review',
    COPY_READY: 'copy_ready',
    MEDIA_READY: 'media_ready',
    READY: 'ready',
    SCHEDULED: 'scheduled',
    PUBLISHED: 'published',
    ARCHIVED: 'archived',
    REJECTED: 'rejected',
    DUPLICATE: 'duplicate',
    INCOMPLETE: 'incomplete',
    WITHDRAWN: 'withdrawn',
});

export const ARTICLE_STATUS_ORDER = Object.freeze([
    ARTICLE_STATUSES.IMPORTED,
    ARTICLE_STATUSES.AI_PREPARED,
    ARTICLE_STATUSES.NEEDS_REVIEW,
    ARTICLE_STATUSES.COPY_READY,
    ARTICLE_STATUSES.MEDIA_READY,
    ARTICLE_STATUSES.READY,
    ARTICLE_STATUSES.SCHEDULED,
    ARTICLE_STATUSES.PUBLISHED,
    ARTICLE_STATUSES.ARCHIVED,
]);

export const CLOSED_ARTICLE_STATUSES = Object.freeze([
    ARTICLE_STATUSES.PUBLISHED,
    ARTICLE_STATUSES.ARCHIVED,
    ARTICLE_STATUSES.REJECTED,
    ARTICLE_STATUSES.DUPLICATE,
    ARTICLE_STATUSES.WITHDRAWN,
]);

export const ISSUE_STATUSES = Object.freeze({
    PLANNING: 'planning',
    ACTIVE: 'active',
    CLOSED: 'closed',
    PUBLISHED: 'published',
    ARCHIVED: 'archived',
});

export const IMPORT_BATCH_STATUSES = Object.freeze({
    DISCOVERED: 'discovered',
    RUNNING: 'running',
    PARTIAL: 'partial',
    COMPLETED: 'completed',
    FAILED: 'failed',
});

export const SOURCE_TYPES = Object.freeze({
    MANUAL: 'manual',
    GOOGLE_DRIVE: 'google_drive',
});

export const READINESS_LEVELS = Object.freeze({
    NOT_READY: 'not_ready',
    NEEDS_REVIEW: 'needs_review',
    READY: 'ready',
});

export const BLOCKER_CODES = Object.freeze({
    MISSING_TITLE: 'missing_title',
    MISSING_AUTHOR: 'missing_author',
    MISSING_DATE: 'missing_date',
    MISSING_BLURB: 'missing_blurb',
    MISSING_TAG: 'missing_tag',
    MISSING_BODY: 'missing_body',
    AUTHOR_UNMATCHED: 'author_unmatched',
    SOURCE_INCOMPLETE: 'source_incomplete',
    SOURCE_CHANGED: 'source_changed',
    IMAGE_RIGHTS: 'image_rights_unresolved',
    ANALYSIS_FAILED: 'analysis_failed',
});

const ARTICLE_STATUS_SET = new Set(Object.values(ARTICLE_STATUSES));
const ISSUE_STATUS_SET = new Set(Object.values(ISSUE_STATUSES));
const READINESS_SET = new Set(Object.values(READINESS_LEVELS));

const cleanString = (value, fallback = '') =>
    typeof value === 'string' ? value.trim() : fallback;

const cleanNullableString = (value) => {
    const result = cleanString(value);
    return result || null;
};

const cleanStringArray = (value) => Array.from(new Set(
    (Array.isArray(value) ? value : [])
        .map((item) => cleanString(item))
        .filter(Boolean),
));

const cleanPositiveInteger = (value) => {
    const number = typeof value === 'string' && value.trim() ? Number(value) : value;
    return Number.isInteger(number) && number > 0 ? number : null;
};

export function normalizeArticleStatus(value, fallback = ARTICLE_STATUSES.IMPORTED) {
    return ARTICLE_STATUS_SET.has(value) ? value : fallback;
}

export function normalizeIssueStatus(value, fallback = ISSUE_STATUSES.PLANNING) {
    return ISSUE_STATUS_SET.has(value) ? value : fallback;
}

export function normalizeReadiness(value, fallback = READINESS_LEVELS.NEEDS_REVIEW) {
    return READINESS_SET.has(value) ? value : fallback;
}

export function createSourceProvenance(input = {}) {
    const type = Object.values(SOURCE_TYPES).includes(input.type)
        ? input.type
        : SOURCE_TYPES.MANUAL;

    return {
        type,
        url: cleanNullableString(input.url),
        driveFileId: cleanNullableString(input.driveFileId ?? input.fileId),
        tabId: cleanNullableString(input.tabId),
        revisionId: cleanNullableString(input.revisionId ?? input.sourceRevision),
        sourceName: cleanNullableString(input.sourceName ?? input.name),
        importedAt: input.importedAt ?? null,
    };
}

/** Stable key used to avoid creating the same imported draft more than once. */
export function getSourceIdempotencyKey(source = {}) {
    const normalized = createSourceProvenance(source);
    if (!normalized.driveFileId) return null;
    return [
        normalized.driveFileId,
        normalized.tabId || 'document',
        normalized.revisionId || 'current',
    ].map(encodeURIComponent).join(':');
}

export function createIssueRecord(input = {}) {
    return {
        name: cleanString(input.name),
        slug: cleanString(input.slug),
        schoolYear: cleanString(input.schoolYear),
        volumeNumber: cleanPositiveInteger(input.volumeNumber),
        issueNumber: cleanPositiveInteger(input.issueNumber),
        status: normalizeIssueStatus(input.status),
        targetPublicationDate: input.targetPublicationDate ?? null,
        publishedAt: input.publishedAt ?? null,
        theme: cleanNullableString(input.theme),
        editorNote: cleanNullableString(input.editorNote),
        internalNote: cleanNullableString(input.internalNote),
        coverImageId: cleanNullableString(input.coverImageId),
        editorIds: cleanStringArray(input.editorIds ?? input.editors),
        sourceFolderIds: cleanStringArray(input.sourceFolderIds),
        sourceSpreadsheetId: cleanNullableString(input.sourceSpreadsheetId),
        sourceSpreadsheetUrl: cleanNullableString(input.sourceSpreadsheetUrl),
        sourceSheetName: cleanString(input.sourceSheetName, 'ARTICLES'),
        sourceMonth: cleanNullableString(input.sourceMonth),
        createdAt: input.createdAt ?? null,
        updatedAt: input.updatedAt ?? null,
    };
}

export function createImportBatchRecord(input = {}) {
    const counts = input.counts && typeof input.counts === 'object' ? input.counts : {};
    return {
        issueId: cleanNullableString(input.issueId),
        status: Object.values(IMPORT_BATCH_STATUSES).includes(input.status)
            ? input.status
            : IMPORT_BATCH_STATUSES.DISCOVERED,
        spreadsheetId: cleanNullableString(input.spreadsheetId),
        spreadsheetUrl: cleanNullableString(input.spreadsheetUrl),
        sheetName: cleanString(input.sheetName, 'ARTICLES'),
        month: cleanNullableString(input.month),
        selectedSourceKeys: cleanStringArray(input.selectedSourceKeys),
        counts: {
            discovered: Number(counts.discovered) || 0,
            selected: Number(counts.selected) || 0,
            imported: Number(counts.imported) || 0,
            existing: Number(counts.existing) || 0,
            failed: Number(counts.failed) || 0,
            skipped: Number(counts.skipped) || 0,
        },
        createdBy: cleanNullableString(input.createdBy),
        createdAt: input.createdAt ?? null,
        updatedAt: input.updatedAt ?? null,
        completedAt: input.completedAt ?? null,
    };
}

export function formatIssueNumber(issue = {}) {
    const parts = [];
    const volumeNumber = cleanPositiveInteger(issue.volumeNumber);
    const issueNumber = cleanPositiveInteger(issue.issueNumber);
    if (volumeNumber) parts.push(`Vol. ${volumeNumber}`);
    if (issueNumber) parts.push(`No. ${issueNumber}`);
    return parts.join(', ');
}

export function formatIssueLabel(issue = {}, {includeSchoolYear = true} = {}) {
    const name = cleanString(issue.name, 'Untitled issue');
    const details = [];
    if (includeSchoolYear && cleanString(issue.schoolYear)) details.push(cleanString(issue.schoolYear));
    const number = formatIssueNumber(issue);
    if (number) details.push(number);
    return details.length ? `${name} · ${details.join(' · ')}` : name;
}

export function isPublicIssue(issue = {}) {
    const status = normalizeIssueStatus(issue.status);
    return status === ISSUE_STATUSES.PUBLISHED || (status === ISSUE_STATUSES.ARCHIVED && Boolean(issue.publishedAt));
}

export function createBlocker(code, message, details = {}) {
    return {
        code: cleanString(code, 'unknown'),
        message: cleanString(message),
        field: cleanNullableString(details.field),
        source: cleanNullableString(details.source),
    };
}

export function normalizeBlockers(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.reduce((result, item) => {
        const blocker = typeof item === 'string'
            ? createBlocker(item, item.replaceAll('_', ' '))
            : createBlocker(item?.code, item?.message, item || {});
        const key = `${blocker.code}:${blocker.field || ''}`;
        if (!blocker.message || seen.has(key)) return result;
        seen.add(key);
        result.push(blocker);
        return result;
    }, []);
}

export function getArticleBlockers(article = {}) {
    const blockers = [];
    if (!cleanString(article.title)) blockers.push(createBlocker(BLOCKER_CODES.MISSING_TITLE, 'Add a headline.', {field: 'title'}));
    if (cleanStringArray(article.authorIds).length === 0) blockers.push(createBlocker(BLOCKER_CODES.MISSING_AUTHOR, 'Match at least one staff credit.', {field: 'authorIds'}));
    if (!article.publicationDate && !article.date) blockers.push(createBlocker(BLOCKER_CODES.MISSING_DATE, 'Choose a publication date.', {field: 'publicationDate'}));
    if (!cleanString(article.blurb)) blockers.push(createBlocker(BLOCKER_CODES.MISSING_BLURB, 'Add a homepage blurb.', {field: 'blurb'}));
    if (cleanStringArray(article.tags).length === 0) blockers.push(createBlocker(BLOCKER_CODES.MISSING_TAG, 'Choose at least one site tag.', {field: 'tags'}));
    if (!cleanString(article.markdown ?? article.articleMarkdown)) blockers.push(createBlocker(BLOCKER_CODES.MISSING_BODY, 'Add article body copy.', {field: 'markdown'}));
    return normalizeBlockers([...blockers, ...(article.blockers || [])]);
}

export function getArticleReadiness(article = {}) {
    const blockers = getArticleBlockers(article);
    return {
        level: blockers.length === 0 ? READINESS_LEVELS.READY : READINESS_LEVELS.NEEDS_REVIEW,
        blockers,
        ready: blockers.length === 0,
    };
}

export function createArticleDraft(input = {}) {
    const draft = {
        status: normalizeArticleStatus(input.status),
        title: cleanString(input.title),
        authorIds: cleanStringArray(input.authorIds),
        publicationDate: input.publicationDate ?? input.date ?? null,
        scheduledAt: input.scheduledAt ?? null,
        publishedAt: input.publishedAt ?? null,
        markdown: cleanString(input.markdown ?? input.articleMarkdown),
        blurb: cleanString(input.blurb),
        tags: cleanStringArray(input.tags),
        featuredImageId: cleanNullableString(input.featuredImageId),
        issueId: cleanNullableString(input.issueId),
        source: createSourceProvenance(input.source),
        assignedEditorId: cleanNullableString(input.assignedEditorId ?? input.workflow?.assignedEditorId),
        blockers: normalizeBlockers(input.blockers ?? input.workflow?.blockers),
        ai: input.ai && typeof input.ai === 'object' ? {...input.ai} : null,
        createdAt: input.createdAt ?? null,
        updatedAt: input.updatedAt ?? null,
    };
    draft.blockers = getArticleBlockers(draft);
    draft.readiness = normalizeReadiness(
        input.readiness?.level ?? input.readiness,
        draft.blockers.length ? READINESS_LEVELS.NEEDS_REVIEW : READINESS_LEVELS.READY,
    );
    return draft;
}

const isTimestampLike = (value) => value && typeof value === 'object'
    && (typeof value.toDate === 'function' || typeof value.seconds === 'number');

const isPlainObject = (value) => {
    if (!value || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};

/** Convert Firestore records to JSON-safe props without mutating the source. */
export function serializeNewsroomValue(value) {
    if (value === undefined) return null;
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    if (isTimestampLike(value)) {
        try {
            const date = typeof value.toDate === 'function'
                ? value.toDate()
                : new Date((value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1000000));
            return Number.isNaN(date.getTime()) ? null : date.toISOString();
        } catch (error) {
            return null;
        }
    }
    if (Array.isArray(value)) return value.map(serializeNewsroomValue);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeNewsroomValue(item)]));
}

/** Remove undefined values before a Firebase write while preserving sentinels and Dates. */
export function compactNewsroomWrite(value) {
    if (Array.isArray(value)) return value.map(compactNewsroomWrite).filter((item) => item !== undefined);
    if (!value || typeof value !== 'object' || value instanceof Date || isTimestampLike(value) || !isPlainObject(value)) return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, compactNewsroomWrite(item)]));
}
