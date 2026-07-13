export const UPLOAD_DRAFT_STORAGE_KEY = 'yellowpages-upload-draft-v1';
export const IMPORT_MEDIA_STORAGE_KEY = 'yellowpages-import-media-v1';

export const normalizeImportedSourceText = (value = '') => String(value)
    .replace(/\r\n/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/^[ \t]{4,6}(?=\S)/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const normalizeComparableText = (value = '') => value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();

export const stripImportedPublicationHeader = ({markdown = '', title = '', authors = []} = {}) => {
    const lines = String(markdown).replace(/\r\n/g, '\n').split('\n');
    let firstContentLine = lines.findIndex((line) => line.trim().length > 0);
    if (firstContentLine < 0) return '';

    const expectedTitle = normalizeComparableText(title);
    const firstLineText = lines[firstContentLine].trim().replace(/^#\s+/, '').replace(/^([*_]{1,3})(.*)\1$/, '$2').trim();
    if (expectedTitle && normalizeComparableText(firstLineText) === expectedTitle) {
        lines.splice(firstContentLine, 1);
        while (lines[firstContentLine]?.trim() === '') lines.splice(firstContentLine, 1);
    }

    const candidateByline = (lines[firstContentLine] || '').trim().replace(/^([*_]{1,3})(.*)\1$/, '$2').trim();
    const normalizedByline = normalizeComparableText(candidateByline.replace(/^by\s+/i, ''));
    const normalizedAuthors = (authors || []).map(normalizeComparableText).filter(Boolean);
    const matchesAuthors = normalizedAuthors.length > 0 && normalizedAuthors.every((author) => normalizedByline.includes(author));
    const looksLikeByline = /^by\s+/i.test(candidateByline) || normalizedByline === normalizedAuthors.join(' ');
    if (looksLikeByline && matchesAuthors) {
        lines.splice(firstContentLine, 1);
        while (lines[firstContentLine]?.trim() === '') lines.splice(firstContentLine, 1);
    }

    return lines.join('\n').trim();
};

const inferRole = (placement = '') => {
    const normalized = placement.toLowerCase();
    if (normalized.includes('featured') || normalized.includes('hero')) return 'featured';
    if (normalized.includes('inline') || normalized.includes('body') || normalized.includes('after')) return 'inline';
    return 'unused';
};

const recommendationRole = (recommendation) => {
    if (['featured', 'inline', 'unused'].includes(recommendation?.role)) return recommendation.role;
    return inferRole(recommendation?.placement);
};

export const buildImportMediaItems = (inspection, analysis, imageSources = []) => {
    const recommendations = new Map(
        (analysis?.imageRecommendations || []).map((recommendation) => [recommendation.sourceId, recommendation])
    );
    const separateImages = (inspection?.images || []).map((image) => ({
        key: `drive:${image.id}`,
        sourceId: image.id,
        sourceName: image.name,
        sourceKind: 'drive_file',
        mimeType: image.mimeType || '',
        previewUrl: image.thumbnailLink || '',
        fetchUrl: '',
    }));
    const inlineImages = (inspection?.documents || []).flatMap((document) =>
        (document.tabs || []).flatMap((tab) =>
            (tab.inlineImages || []).map((image, index) => ({
                key: `inline:${image.id}`,
                sourceId: image.id,
                sourceName: `${document.name} — ${tab.title} — embedded image ${index + 1}`,
                sourceKind: 'doc_inline',
                mimeType: 'image/*',
                previewUrl: image.contentUri || '',
                fetchUrl: image.contentUri || '',
            }))
        )
    );

    const sources = new Map((imageSources || []).map((item) => [item.sourceId, item]));
    const items = [...separateImages, ...inlineImages].map((item) => {
        const recommendation = recommendations.get(item.sourceId);
        const lookup = sources.get(item.sourceId);
        const webSource = lookup?.source || null;
        return {
            ...item,
            role: recommendationRole(recommendation),
            insertAfterParagraph: Number.isInteger(recommendation?.insertAfterParagraph)
                ? recommendation.insertAfterParagraph
                : null,
            caption: recommendation?.caption || '',
            altText: recommendation?.altText || '',
            credit: webSource?.domain || '',
            sourceUrl: webSource?.url || '',
            sourceTitle: webSource?.pageTitle || '',
            sourceMatch: webSource?.matchType || '',
            sourceLookupStatus: lookup?.status || 'not_run',
            rightsStatus: webSource ? 'web_source' : 'source_not_found',
            aiVisuallyAnalyzed: Boolean(recommendation?.visuallyAnalyzed),
            aiWarning: recommendation?.warning || '',
            importedImageId: '',
        };
    });
    const selected = items.filter((item) => item.role !== 'unused');
    if (!selected.length) return items;
    const featured = selected.find((item) => item.role === 'featured') || selected[0];
    return items.map((item) => {
        if (item.key === featured.key) return {...item, role: 'featured', insertAfterParagraph: null};
        if (item.role === 'featured') return {...item, role: 'inline'};
        return item;
    });
};
