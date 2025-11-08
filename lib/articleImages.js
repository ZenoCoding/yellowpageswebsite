const IMAGE_TOKEN_REGEX = /\{\{\s*image:([a-zA-Z0-9_-]+)\s*\}\}/gi;

const escapeHtml = (input = '') =>
    String(input)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const escapeAttribute = (input = '') =>
    String(input)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');

export const extractImageTokenIds = (markdown = '') => {
    const ids = new Set();
    let match;
    while ((match = IMAGE_TOKEN_REGEX.exec(markdown)) !== null) {
        if (match[1]) {
            ids.add(match[1].trim());
        }
    }
    return Array.from(ids);
};

const buildFigureHtml = (record, {imageId}) => {
    if (!record || typeof record.url !== 'string') {
        return `<figure class="article-figure missing-image" data-image-id="${escapeAttribute(imageId)}">
    <div class="article-figure__placeholder">Image unavailable</div>
</figure>`;
    }
    const altText = record.altText || record.caption || 'Article image';
    const captionParts = [];
    if (record.caption) {
        captionParts.push(`<span class="article-figure__caption-text">${escapeHtml(record.caption)}</span>`);
    }
    if (record.credit) {
        captionParts.push(`<span class="article-figure__credit">Photo by ${escapeHtml(record.credit)}</span>`);
    }
    const captionHtml =
        captionParts.length > 0
            ? `<figcaption class="article-figure__caption">${captionParts.join('')}</figcaption>`
            : '';
    return `<figure class="article-figure" data-image-id="${escapeAttribute(record.id || imageId)}">
    <img src="${escapeAttribute(record.url)}" alt="${escapeAttribute(altText)}" loading="lazy" decoding="async" />
    ${captionHtml}
</figure>`;
};

export const replaceImageTokensWithFigures = (markdown = '', imageMap = new Map()) => {
    if (typeof markdown !== 'string' || markdown.length === 0) {
        return markdown;
    }
    return markdown.replace(IMAGE_TOKEN_REGEX, (_, imageId) => {
        const trimmedId = imageId?.trim();
        if (!trimmedId) {
            return '';
        }
        const record =
            imageMap instanceof Map
                ? imageMap.get(trimmedId)
                : Array.isArray(imageMap)
                ? imageMap.find((item) => item?.id === trimmedId)
                : imageMap?.[trimmedId];
        return buildFigureHtml(record, {imageId: trimmedId});
    });
};

const escapeRegExp = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const normalizeLegacyImageMarkdown = (markdown = '', images = []) => {
    if (typeof markdown !== 'string' || markdown.length === 0) {
        return {
            markdown: '',
        };
    }
    let updated = markdown;
    const matchedImageIds = new Set(extractImageTokenIds(markdown));
    const imageList = Array.isArray(images) ? images : [];

    imageList.forEach((image) => {
        if (!image || typeof image.url !== 'string' || typeof image.id !== 'string') {
            return;
        }
        const escapedUrl = escapeRegExp(image.url);
        const pattern = new RegExp(
            `!\\[[^\\]]*\\]\\(${escapedUrl}(?:\\s+"[^"]*")?\\)`,
            'g'
        );
        if (pattern.test(updated)) {
            updated = updated.replace(pattern, `{{image:${image.id}}}`);
            matchedImageIds.add(image.id);
        }
    });

    return {
        markdown: updated,
        referencedImageIds: Array.from(matchedImageIds),
    };
};
