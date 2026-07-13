const MIN_ARTICLE_CHARACTERS = 100;
const AUTO_READY_CONFIDENCE = 0.85;

const BLOCKER_ACTIONS = {
    headline: 'Add or confirm the article headline.',
    'staff credit': 'Add at least one staff byline.',
    'unmatched staff credit': 'Match the byline to a staff profile.',
    'publication date': 'Choose the issue publication date.',
    'site tag': 'Choose at least one section or site tag.',
    'article body': 'Add the complete article body.',
    'source exceeded analysis limit': 'Check the full source for text beyond the AI analysis limit.',
    'source is not a finished article': 'Open the source and select or add the finished article draft.',
    'low AI confidence': 'Confirm that the selected Google Doc and tab contain the final article.',
    'unfinished text or unresolved placeholder': 'Resolve the unfinished text, placeholder, or incomplete quotation.',
};

const toMillis = (value) => value?.toMillis?.() || value?.toDate?.()?.getTime?.() || 0;

export const getDraftReviewActions = (draft = {}) => Array.from(new Set(
    (Array.isArray(draft.blockers) ? draft.blockers : [])
        .map((blocker) => BLOCKER_ACTIONS[blocker] || `Review: ${String(blocker).trim()}.`)
        .filter(Boolean)
));

export const getDraftReviewContext = (draft = {}) => {
    const blockers = new Set(Array.isArray(draft.blockers) ? draft.blockers : []);
    if (![...blockers].some((blocker) => [
        'low AI confidence',
        'source is not a finished article',
        'unfinished text or unresolved placeholder',
        'source exceeded analysis limit',
    ].includes(blocker))) return [];
    return Array.from(new Set([
        ...(draft.ai?.editorialNotes || []),
        ...(draft.ai?.warnings || []),
    ].map((note) => String(note || '').trim()).filter(Boolean))).slice(0, 2);
};

const reviewPriority = (draft = {}) => {
    if ((Array.isArray(draft.blockers) && draft.blockers.length) || ['needs_review', 'incomplete', 'imported', 'ai_prepared'].includes(draft.status)) return 0;
    if (['ready', 'copy_ready', 'media_ready'].includes(draft.status)) return 1;
    if (draft.status === 'published') return 2;
    return 3;
};

export const compareDraftsForReview = (first, second) =>
    reviewPriority(first) - reviewPriority(second)
    || toMillis(second?.updatedAt) - toMillis(first?.updatedAt)
    || String(first?.title || '').localeCompare(String(second?.title || ''));

const plainText = (markdown = '') => String(markdown)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~`>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** A card excerpt made only from words already present in the student's article. */
export const deriveVerbatimExcerpt = (markdown = '', maximumCharacters = 240) => {
    const text = plainText(markdown);
    if (!text) return '';
    const sentences = text.match(/[^.!?]+[.!?]+(?:[”"']+)?|[^.!?]+$/g) || [text];
    let excerpt = '';
    for (const sentence of sentences) {
        const candidate = `${excerpt}${excerpt ? ' ' : ''}${sentence.trim()}`;
        if (candidate.length > maximumCharacters && excerpt) break;
        excerpt = candidate;
        if (excerpt.length >= 90 || excerpt.length >= maximumCharacters) break;
    }
    if (excerpt.length <= maximumCharacters) return excerpt;
    const boundary = excerpt.slice(0, maximumCharacters + 1).lastIndexOf(' ');
    return `${excerpt.slice(0, boundary > 80 ? boundary : maximumCharacters).trim()}…`;
};

export const evaluateAutomationEligibility = ({
    title,
    authorIds,
    unmatchedAuthors,
    date,
    tags,
    markdown,
    analysis,
    inputTruncated = false,
} = {}) => {
    const blockers = [];
    if (!String(title || '').trim()) blockers.push('headline');
    if (!Array.isArray(authorIds) || authorIds.length === 0) blockers.push('staff credit');
    if (Array.isArray(unmatchedAuthors) && unmatchedAuthors.length) blockers.push('unmatched staff credit');
    if (!String(date || '').trim()) blockers.push('publication date');
    if (!Array.isArray(tags) || tags.length === 0) blockers.push('site tag');
    if (String(markdown || '').trim().length < MIN_ARTICLE_CHARACTERS) blockers.push('article body');
    if (inputTruncated) blockers.push('source exceeded analysis limit');
    if (analysis?.readiness === 'not_ready') blockers.push('source is not a finished article');
    if (typeof analysis?.confidence !== 'number' || analysis.confidence < AUTO_READY_CONFIDENCE) blockers.push('low AI confidence');
    const reviewText = [...(analysis?.warnings || []), ...(analysis?.editorialNotes || [])].join(' ').toLowerCase();
    const structuralConcern = /multiple plausible|competing draft|unfinished (?:article|draft)|not a complete article|incomplete (?:article|draft|quotation|quote|sentence)|quotation is incomplete|quote is incomplete|unresolved placeholder|literal placeholder|pitch\/interview-notes|not publishable article text/.test(reviewText);
    const bodyHasPlaceholder = /\(\s*#\s*\)|\b(?:todo|tbd)\b|\[\s*(?:insert|add|placeholder)[^\]]*\]|\?\?\?/i.test(String(markdown || ''));
    if (structuralConcern || bodyHasPlaceholder) blockers.push('unfinished text or unresolved placeholder');
    return {eligible: blockers.length === 0, blockers};
};
