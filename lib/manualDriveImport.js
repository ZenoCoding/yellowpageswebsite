const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const GOOGLE_DOC_MIME_TYPE = 'application/vnd.google-apps.document';
const PDF_MIME_TYPE = 'application/pdf';
const DRIVE_SHORTCUT_MIME_TYPE = 'application/vnd.google-apps.shortcut';

const GOOGLE_FILE_ID_PATTERN = /^[a-zA-Z0-9_-]{10,}$/;

export const extractGoogleFileId = (input = '') => {
    const value = String(input).trim();
    if (!value) return null;
    if (GOOGLE_FILE_ID_PATTERN.test(value)) return value;

    try {
        const url = new URL(value);
        const pathMatch = url.pathname.match(/\/(?:folders|d)\/([a-zA-Z0-9_-]+)/);
        if (pathMatch?.[1]) return pathMatch[1];
        const queryId = url.searchParams.get('id');
        return queryId && GOOGLE_FILE_ID_PATTERN.test(queryId) ? queryId : null;
    } catch {
        return null;
    }
};

const googleApiRequest = async (url, accessToken) => {
    const response = await fetch(url, {
        headers: {Authorization: `Bearer ${accessToken}`},
    });
    if (!response.ok) {
        let details = '';
        try {
            const payload = await response.json();
            details = payload?.error?.message || '';
        } catch {
            details = await response.text();
        }
        const error = new Error(details || `Google API request failed (${response.status}).`);
        error.status = response.status;
        throw error;
    }
    return response.json();
};

const fileFields = 'id,name,mimeType,size,modifiedTime,webViewLink,thumbnailLink,imageMediaMetadata,parents,shortcutDetails(targetId,targetMimeType)';

const getDriveFile = (fileId, accessToken) =>
    googleApiRequest(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=${encodeURIComponent(fileFields)}`,
        accessToken
    );

const listFolderChildren = async (folderId, accessToken) => {
    const files = [];
    let pageToken = null;
    do {
        const params = new URLSearchParams({
            q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`,
            fields: `nextPageToken,files(${fileFields})`,
            pageSize: '1000',
            orderBy: 'folder,name',
            supportsAllDrives: 'true',
            includeItemsFromAllDrives: 'true',
        });
        if (pageToken) params.set('pageToken', pageToken);
        const result = await googleApiRequest(
            `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
            accessToken
        );
        files.push(...(result.files || []));
        pageToken = result.nextPageToken || null;
    } while (pageToken);
    return files;
};

const resolveShortcut = async (file, accessToken) => {
    if (file.mimeType !== DRIVE_SHORTCUT_MIME_TYPE || !file.shortcutDetails?.targetId) {
        return file;
    }
    const target = await getDriveFile(file.shortcutDetails.targetId, accessToken);
    return {
        ...target,
        shortcutId: file.id,
        shortcutName: file.name,
    };
};

const walkFolder = async (folder, accessToken, depth = 0, seen = new Set()) => {
    if (seen.has(folder.id)) return [];
    seen.add(folder.id);

    const children = await listFolderChildren(folder.id, accessToken);
    const entries = [];
    for (const child of children) {
        let resolved = child;
        let accessError = null;
        try {
            resolved = await resolveShortcut(child, accessToken);
        } catch (error) {
            accessError = error.message;
        }
        const entry = {...resolved, depth, accessError};
        entries.push(entry);
        if (!accessError && resolved.mimeType === DRIVE_FOLDER_MIME_TYPE) {
            entries.push(...await walkFolder(resolved, accessToken, depth + 1, seen));
        }
    }
    return entries;
};

const collectStructuralText = (elements = [], inlineObjectIds = []) => {
    let text = '';
    for (const element of elements) {
        if (element.paragraph) {
            for (const paragraphElement of element.paragraph.elements || []) {
                text += paragraphElement.textRun?.content || '';
                if (paragraphElement.inlineObjectElement) {
                    text += '[Inline image]';
                    if (paragraphElement.inlineObjectElement.inlineObjectId) {
                        inlineObjectIds.push(paragraphElement.inlineObjectElement.inlineObjectId);
                    }
                }
            }
        }
        if (element.table) {
            for (const row of element.table.tableRows || []) {
                for (const cell of row.tableCells || []) {
                    text += collectStructuralText(cell.content || [], inlineObjectIds);
                }
            }
        }
        if (element.tableOfContents) {
            text += collectStructuralText(element.tableOfContents.content || [], inlineObjectIds);
        }
    }
    return text;
};

const flattenTabs = (tabs = [], output = []) => {
    for (const tab of tabs) {
        const body = tab.documentTab?.body?.content || [];
        const inlineObjectIds = [];
        const text = collectStructuralText(body, inlineObjectIds).trim();
        const inlineObjects = tab.documentTab?.inlineObjects || {};
        const inlineImages = Array.from(new Set(inlineObjectIds)).map((objectId) => {
            const embeddedObject = inlineObjects[objectId]?.inlineObjectProperties?.embeddedObject;
            const imageProperties = embeddedObject?.imageProperties;
            return {
                id: objectId,
                contentUri: imageProperties?.contentUri || null,
                sourceUri: imageProperties?.sourceUri || null,
                altTextTitle: embeddedObject?.title || '',
                altTextDescription: embeddedObject?.description || '',
            };
        });
        output.push({
            id: tab.tabProperties?.tabId || null,
            title: tab.tabProperties?.title || 'Untitled tab',
            text,
            characterCount: text.length,
            inlineObjectCount: Object.keys(inlineObjects).length,
            inlineImages,
        });
        flattenTabs(tab.childTabs || [], output);
    }
    return output;
};

const inspectGoogleDoc = async (file, accessToken) => {
    const document = await googleApiRequest(
        `https://docs.googleapis.com/v1/documents/${encodeURIComponent(file.id)}?includeTabsContent=true`,
        accessToken
    );
    let tabs = flattenTabs(document.tabs || []);
    if (tabs.length === 0) {
        const text = collectStructuralText(document.body?.content || []).trim();
        tabs = [{
            id: null,
            title: 'Document body',
            text,
            characterCount: text.length,
            inlineObjectCount: Object.keys(document.inlineObjects || {}).length,
            inlineImages: Object.entries(document.inlineObjects || {}).map(([objectId, inlineObject]) => {
                const embeddedObject = inlineObject?.inlineObjectProperties?.embeddedObject;
                const imageProperties = embeddedObject?.imageProperties;
                return {
                    id: objectId,
                    contentUri: imageProperties?.contentUri || null,
                    sourceUri: imageProperties?.sourceUri || null,
                    altTextTitle: embeddedObject?.title || '',
                    altTextDescription: embeddedObject?.description || '',
                };
            }),
        }];
    }
    return {
        id: file.id,
        name: file.name || document.title,
        webViewLink: file.webViewLink || `https://docs.google.com/document/d/${file.id}/edit`,
        modifiedTime: file.modifiedTime || null,
        tabs,
    };
};

const arrayBufferToDataUrl = (arrayBuffer, mimeType) => {
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunkSize, bytes.length)));
    }
    return `data:${mimeType};base64,${btoa(binary)}`;
};

const inspectPdf = async (file, accessToken) => {
    if (Number(file.size || 0) > 20 * 1024 * 1024) throw new Error('PDF is larger than the 20 MB import limit.');
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`, {
        headers: {Authorization: `Bearer ${accessToken}`},
    });
    if (!response.ok) {
        const error = new Error(`PDF download failed (${response.status}).`);
        error.status = response.status;
        throw error;
    }
    return {
        id: file.id,
        name: file.name || 'Article.pdf',
        mimeType: PDF_MIME_TYPE,
        modifiedTime: file.modifiedTime || null,
        webViewLink: file.webViewLink || null,
        dataUrl: arrayBufferToDataUrl(await response.arrayBuffer(), PDF_MIME_TYPE),
    };
};

export const inspectDriveSource = async ({source, accessToken}) => {
    const sourceId = extractGoogleFileId(source);
    if (!sourceId) throw new Error('Paste a valid Google Drive folder or Google Doc link.');
    if (!accessToken) throw new Error('Google Drive authorization is required.');

    const root = await resolveShortcut(await getDriveFile(sourceId, accessToken), accessToken);
    let files;
    if (root.mimeType === DRIVE_FOLDER_MIME_TYPE) {
        files = await walkFolder(root, accessToken);
    } else if ([GOOGLE_DOC_MIME_TYPE, PDF_MIME_TYPE].includes(root.mimeType)) {
        files = [{...root, depth: 0, accessError: null}];
    } else {
        throw new Error('The pasted link must point to a Google Drive folder, Google Doc, or PDF.');
    }

    const documents = [];
    const warnings = [];
    for (const file of files.filter((item) => item.mimeType === GOOGLE_DOC_MIME_TYPE)) {
        try {
            documents.push(await inspectGoogleDoc(file, accessToken));
        } catch (error) {
            warnings.push(`Could not read ${file.name}: ${error.message}`);
        }
    }
    for (const file of files.filter((item) => item.accessError)) {
        warnings.push(`Could not open shortcut ${file.shortcutName || file.name}: ${file.accessError}`);
    }
    const pdfFiles = [];
    for (const file of files.filter((item) => item.mimeType === PDF_MIME_TYPE)) {
        try {
            pdfFiles.push(await inspectPdf(file, accessToken));
        } catch (error) {
            warnings.push(`Could not read ${file.name}: ${error.message}`);
        }
    }

    return {
        root: {
            id: root.id,
            name: root.name,
            mimeType: root.mimeType,
            webViewLink: root.webViewLink || source,
        },
        files,
        documents,
        pdfFiles,
        images: files.filter((item) => item.mimeType?.startsWith('image/')),
        warnings,
    };
};

const loadBrowserImage = (url) =>
    new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('The browser could not decode this image format.'));
        image.src = url;
    });

const blobToVisionDataUrl = async (blob, maxDimension = 768) => {
    const objectUrl = URL.createObjectURL(blob);
    try {
        const image = await loadBrowserImage(objectUrl);
        const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Image preparation is unavailable in this browser.');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.76);
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
};

export const prepareVisionImages = async ({inspection, accessToken, maximumImages = 6}) => {
    if (!inspection || !accessToken) return {images: [], warnings: []};
    const candidates = [
        ...(inspection.images || []).map((image) => ({
            sourceId: image.id,
            sourceName: image.name,
            sourceKind: 'drive_file',
            fetchUrl: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(image.id)}?alt=media`,
        })),
        ...(inspection.documents || []).flatMap((document) =>
            (document.tabs || []).flatMap((tab) =>
                (tab.inlineImages || []).map((image, index) => ({
                    sourceId: image.id,
                    sourceName: `${document.name} — ${tab.title} — embedded image ${index + 1}`,
                    sourceKind: 'doc_inline',
                    fetchUrl: image.contentUri,
                }))
            )
        ),
    ].filter((candidate) => candidate.fetchUrl).slice(0, maximumImages);

    const images = [];
    const warnings = [];
    for (const candidate of candidates) {
        try {
            const response = await fetch(candidate.fetchUrl, {
                headers: {Authorization: `Bearer ${accessToken}`},
            });
            if (!response.ok) throw new Error(`download failed (${response.status})`);
            const blob = await response.blob();
            if (blob.size > 8 * 1024 * 1024) throw new Error('image is larger than the 8 MB analysis limit');
            if (typeof window === 'undefined' && !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(blob.type)) {
                throw new Error(`unsupported image format (${blob.type || 'unknown'})`);
            }
            const dataUrl = typeof window === 'undefined'
                ? arrayBufferToDataUrl(await blob.arrayBuffer(), blob.type || 'image/jpeg')
                : await blobToVisionDataUrl(blob);
            images.push({
                sourceId: candidate.sourceId,
                sourceName: candidate.sourceName,
                sourceKind: candidate.sourceKind,
                dataUrl,
            });
        } catch (error) {
            warnings.push(`${candidate.sourceName}: ${error.message}`);
        }
    }
    return {images, warnings};
};
