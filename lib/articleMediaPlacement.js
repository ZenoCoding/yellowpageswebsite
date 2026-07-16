const VALID_MEDIA_ROLES = new Set(['featured', 'inline', 'unused']);

const normalizedRole = (value) => VALID_MEDIA_ROLES.has(value) ? value : 'unused';

export const normalizeAutomaticMediaItems = (mediaItems = []) => {
    const sourceItems = Array.isArray(mediaItems) ? mediaItems : [];
    const usesLegacyRecommendations = sourceItems.length > 0
        && sourceItems.every((item) => !Object.prototype.hasOwnProperty.call(item || {}, 'insertAfterParagraph'));
    const normalized = sourceItems.map((item) => ({
        ...item,
        role: usesLegacyRecommendations
            && normalizedRole(item?.role) === 'unused'
            && item?.aiVisuallyAnalyzed
            && String(item?.altText || '').trim()
            && !/(?:duplicate|irrelevant|unusable|not suitable|do not use|unrelated)/i.test(String(item?.aiWarning || ''))
            ? 'inline'
            : normalizedRole(item?.role),
        insertAfterParagraph: Number.isInteger(item?.insertAfterParagraph) && item.insertAfterParagraph > 0
            ? item.insertAfterParagraph
            : null,
    }));
    const selectedIndexes = normalized
        .map((item, index) => item.role !== 'unused' ? index : -1)
        .filter((index) => index >= 0);
    if (!selectedIndexes.length) return normalized;

    const requestedFeaturedIndex = selectedIndexes.find((index) => normalized[index].role === 'featured');
    const featuredIndex = requestedFeaturedIndex ?? selectedIndexes[0];
    return normalized.map((item, index) => {
        if (!selectedIndexes.includes(index)) return item;
        if (index === featuredIndex) return {...item, role: 'featured', insertAfterParagraph: null};
        return {...item, role: 'inline'};
    });
};

const automaticParagraphPosition = ({index, imageCount, paragraphCount}) => {
    if (paragraphCount <= 1) return 1;
    const position = Math.round(((index + 1) * paragraphCount) / (imageCount + 1));
    return Math.max(1, Math.min(paragraphCount - 1, position));
};

export const insertInlineImageTokens = (markdown = '', inlineImages = []) => {
    const source = String(markdown || '').trim();
    const images = (Array.isArray(inlineImages) ? inlineImages : [])
        .filter((image) => image?.id && !source.includes(`{{image:${image.id}}}`));
    if (!source || !images.length) return source;

    const paragraphs = source.split(/\n{2,}/);
    const placements = new Map();
    images.forEach((image, index) => {
        const requested = Number.isInteger(image.insertAfterParagraph) ? image.insertAfterParagraph : null;
        const sequenceCount = Number.isInteger(image.sequenceCount) && image.sequenceCount > 0
            ? image.sequenceCount
            : images.length;
        const sequenceIndex = Number.isInteger(image.sequenceIndex) && image.sequenceIndex >= 0
            ? Math.min(image.sequenceIndex, sequenceCount - 1)
            : index;
        const position = requested
            ? Math.max(1, Math.min(paragraphs.length, requested))
            : automaticParagraphPosition({index: sequenceIndex, imageCount: sequenceCount, paragraphCount: paragraphs.length});
        const tokens = placements.get(position) || [];
        tokens.push(`{{image:${image.id}}}`);
        placements.set(position, tokens);
    });

    const output = [];
    paragraphs.forEach((paragraph, index) => {
        output.push(paragraph);
        output.push(...(placements.get(index + 1) || []));
    });
    return output.join('\n\n');
};

export const repositionLeadingInlineImageTokens = (markdown = '', inlineImages = []) => {
    const images = (Array.isArray(inlineImages) ? inlineImages : []).filter((image) => image?.id);
    if (!images.length) return String(markdown || '');
    const byId = new Map(images.map((image, index) => [image.id, {...image, sequenceIndex: index, sequenceCount: images.length}]));
    let source = String(markdown || '').trim();
    const leading = [];
    while (source) {
        const match = source.match(/^\{\{\s*image:([a-zA-Z0-9_-]+)\s*\}\}\s*/i);
        if (!match || !byId.has(match[1])) break;
        leading.push(byId.get(match[1]));
        source = source.slice(match[0].length).trim();
    }
    return leading.length ? insertInlineImageTokens(source, leading) : String(markdown || '');
};
