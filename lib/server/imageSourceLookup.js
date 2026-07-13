const BLOCKED_SOURCE_HOSTS = new Set([
    'facebook.com', 'instagram.com', 'pinterest.com', 'pinterest.ca', 'tiktok.com', 'x.com', 'twitter.com',
]);

const hostnameFor = (value = '') => {
    try { return new URL(value).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
};

const imageBytes = (dataUrl = '') => {
    const match = String(dataUrl).match(/^data:[^;]+;base64,(.+)$/);
    return match?.[1] || null;
};

const chooseSource = (webDetection = {}) => {
    const pages = (webDetection.pagesWithMatchingImages || []).filter((page) => {
        const host = hostnameFor(page.url);
        return host && !BLOCKED_SOURCE_HOSTS.has(host);
    });
    const page = pages.find((item) => (item.fullMatchingImages || []).length > 0) || pages[0];
    if (!page?.url) return null;
    return {
        url: page.url,
        domain: hostnameFor(page.url),
        pageTitle: page.pageTitle || '',
        matchType: (page.fullMatchingImages || []).length ? 'full' : 'partial',
        confidence: (page.fullMatchingImages || []).length ? 'strong' : 'possible',
    };
};

export const findWebImageSources = async ({images, accessToken}) => {
    const prepared = (images || []).map((image) => ({...image, content: imageBytes(image.dataUrl)})).filter((image) => image.content);
    if (!prepared.length) return [];
    if (!accessToken) return prepared.map((image) => ({sourceId: image.sourceId, source: null, status: 'unavailable'}));
    const response = await fetch('https://vision.googleapis.com/v1/images:annotate', {
        method: 'POST',
        headers: {Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({requests: prepared.map((image) => ({
            image: {content: image.content},
            features: [{type: 'WEB_DETECTION', maxResults: 10}],
        }))}),
    });
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const error = new Error(payload?.error?.message || `Image source lookup failed (${response.status}).`);
        error.status = response.status;
        throw error;
    }
    const payload = await response.json();
    return prepared.map((image, index) => {
        const annotation = payload.responses?.[index] || {};
        const source = chooseSource(annotation.webDetection);
        return {sourceId: image.sourceId, source, status: source ? 'found' : 'not_found'};
    });
};

