import crypto from 'crypto';
import {getFirebaseAdmin} from './firebaseAdmin';
import {evaluateAutomationEligibility} from '../articleAutomation';
import {insertInlineImageTokens, normalizeAutomaticMediaItems} from '../articleMediaPlacement';

const articleIdFor = (draft) => {
    const slug = String(draft.title || '')
        .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
    return draft.date && slug ? `${draft.date}_${slug}` : null;
};

const normalizeName = (value = '') => String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
const editDistance = (first = '', second = '') => {
    const a = normalizeName(first); const b = normalizeName(second);
    const row = Array.from({length: b.length + 1}, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
        let previous = row[0]; row[0] = i;
        for (let j = 1; j <= b.length; j += 1) {
            const current = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
            previous = current;
        }
    }
    return row[b.length];
};

const extensionFor = (contentType = '', name = '') => {
    const fromName = String(name).match(/\.([a-zA-Z0-9]{2,5})$/)?.[1];
    if (fromName) return fromName.toLowerCase();
    return {'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp'}[contentType] || 'jpg';
};

const publicStorageUrl = (bucketName, storagePath, token) =>
    `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;

const importMediaImage = async ({draft, media, articleId, driveAccessToken, userId}) => {
    const admin = getFirebaseAdmin();
    if (media.importedImageId) {
        const existing = await admin.firestore().collection('images').doc(media.importedImageId).get();
        if (existing.exists) return {id: existing.id, ...existing.data(), newlyImported: false};
    }
    if (!driveAccessToken) throw new Error(`Drive access is required to import source images for “${draft.title}”.`);
    const downloadUrl = media.sourceKind === 'drive_file'
        ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(media.sourceId)}?alt=media`
        : media.fetchUrl;
    if (!downloadUrl) return null;
    const response = await fetch(downloadUrl, {headers: {Authorization: `Bearer ${driveAccessToken}`}});
    if (!response.ok) throw new Error(`Image download failed for “${draft.title}” (${response.status}).`);
    const contentType = response.headers.get('content-type') || media.mimeType || 'image/jpeg';
    const extension = extensionFor(contentType, media.sourceName);
    const token = crypto.randomUUID();
    const storagePath = `article-images/${articleId}-${crypto.randomUUID()}.${extension}`;
    const bucket = admin.storage().bucket();
    await bucket.file(storagePath).save(Buffer.from(await response.arrayBuffer()), {
        contentType,
        resumable: false,
        metadata: {metadata: {firebaseStorageDownloadTokens: token}},
    });
    const imageRef = admin.firestore().collection('images').doc();
    const record = {
        url: publicStorageUrl(bucket.name, storagePath, token),
        storagePath,
        fileName: media.sourceName || `${articleId}.${extension}`,
        caption: media.caption || '',
        credit: media.credit || '',
        creditType: media.sourceUrl ? 'source' : null,
        sourceUrl: media.sourceUrl || null,
        sourceTitle: media.sourceTitle || null,
        altText: media.altText || 'Article image',
        linkedArticleIds: [articleId],
        uploadedBy: userId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
        importSourceId: media.sourceId,
        importSourceKind: media.sourceKind,
        rightsStatus: media.rightsStatus || 'source_not_found',
    };
    await imageRef.set(record);
    return {id: imageRef.id, ...record, newlyImported: true};
};

const importDraftMedia = async ({draft, articleId, markdown, driveAccessToken, userId}) => {
    let mediaItems = normalizeAutomaticMediaItems(draft.mediaItems || []);
    const existingFeaturedIndex = mediaItems.findIndex((item) => item.role === 'featured');
    if (draft.featuredImageId && existingFeaturedIndex >= 0 && !mediaItems[existingFeaturedIndex].importedImageId) {
        mediaItems = mediaItems.map((item, index) => index === existingFeaturedIndex
            ? {...item, importedImageId: draft.featuredImageId}
            : item);
    }

    const imported = []; const failures = [];
    for (let index = 0; index < mediaItems.length; index += 1) {
        const media = mediaItems[index];
        if (media.role === 'unused') continue;
        try {
            const image = await importMediaImage({draft, media, articleId, driveAccessToken, userId});
            if (image) imported.push({index, media, image});
        } catch (error) {
            failures.push({
                sourceId: media.sourceId || null,
                sourceName: media.sourceName || 'Image',
                error: error?.message || 'Image import failed.',
            });
        }
    }

    const featuredImport = imported.find((item) => item.media.role === 'featured') || imported[0] || null;
    const inlineImports = imported.filter((item) => item.image.id !== featuredImport?.image.id);
    const updatedMediaItems = mediaItems.map((item, index) => {
        const match = imported.find((result) => result.index === index);
        if (!match) {
            return featuredImport && item.role !== 'unused' ? {...item, role: 'inline'} : item;
        }
        return {
            ...item,
            role: match.image.id === featuredImport?.image.id ? 'featured' : 'inline',
            insertAfterParagraph: match.image.id === featuredImport?.image.id ? null : item.insertAfterParagraph,
            importedImageId: match.image.id,
        };
    });
    const updatedMarkdown = insertInlineImageTokens(markdown, inlineImports.map(({media, image}) => ({
        id: image.id,
        insertAfterParagraph: media.insertAfterParagraph,
    })));
    return {
        featured: featuredImport?.image || null,
        markdown: updatedMarkdown,
        mediaItems: updatedMediaItems,
        importedCount: imported.filter(({image}) => image.newlyImported).length,
        failures,
    };
};

export const backfillIssueImages = async ({issueId, driveAccessToken, userId}) => {
    const admin = getFirebaseAdmin(); const db = admin.firestore();
    const draftsSnapshot = await db.collection('articleDrafts').where('issueId', '==', issueId).get();
    let imported = 0; let skipped = 0; const failed = [];
    for (const snapshot of draftsSnapshot.docs) {
        const draft = {id: snapshot.id, ...snapshot.data()};
        if (draft.status !== 'published' || !draft.publishedArticleId) { skipped += 1; continue; }
        const selectedMedia = normalizeAutomaticMediaItems(draft.mediaItems || []).filter((item) => item.role !== 'unused');
        if (!selectedMedia.length) { skipped += 1; continue; }
        try {
            const articleRef = db.collection('articles').doc(draft.publishedArticleId);
            const articleSnapshot = await articleRef.get();
            if (!articleSnapshot.exists) throw new Error('The published article record no longer exists.');
            const article = articleSnapshot.data() || {};
            const workingDraft = {
                ...draft,
                featuredImageId: draft.featuredImageId || article.featuredImageId || null,
                imageUrl: draft.imageUrl || article.imageUrl || '',
            };
            const result = await importDraftMedia({
                draft: workingDraft,
                articleId: draft.publishedArticleId,
                markdown: article.markdown || draft.markdown || '',
                driveAccessToken,
                userId,
            });
            if (!result.importedCount && !result.featured) {
                failed.push(...result.failures.map((failure) => ({draftId: draft.id, title: draft.title || 'Untitled', ...failure})));
                skipped += 1;
                continue;
            }
            const featured = result.featured || (workingDraft.featuredImageId ? {id: workingDraft.featuredImageId, url: workingDraft.imageUrl} : null);
            const articlePath = article.path || `articles/${draft.publishedArticleId}.md`;
            await admin.storage().bucket().file(articlePath).save(Buffer.from(result.markdown, 'utf8'), {contentType: 'text/markdown; charset=utf-8', resumable: false});
            await Promise.all([
                articleRef.update({
                    featuredImageId: featured?.id || null,
                    imageUrl: featured?.url || '',
                    markdown: result.markdown,
                    path: articlePath,
                }),
                snapshot.ref.update({
                    featuredImageId: featured?.id || null,
                    imageUrl: featured?.url || '',
                    markdown: result.markdown,
                    mediaItems: result.mediaItems,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }),
            ]);
            imported += result.importedCount;
            failed.push(...result.failures.map((failure) => ({draftId: draft.id, title: draft.title || 'Untitled', ...failure})));
        } catch (error) { failed.push({draftId: draft.id, title: draft.title || 'Untitled', error: error?.message || 'Image import failed.'}); }
    }
    return {imported, skipped, failed};
};

const eligibilityForDraft = (draft) => evaluateAutomationEligibility({
    ...draft,
    analysis: {
        readiness: draft.ai?.readiness,
        confidence: draft.ai?.confidence,
        removedMaterial: draft.ai?.removedMaterial,
        warnings: draft.ai?.warnings,
        editorialNotes: draft.ai?.editorialNotes,
    },
    inputTruncated: Boolean(draft.ai?.inputTruncated),
});

export const recheckIssueDrafts = async ({issueId, userId}) => {
    const admin = getFirebaseAdmin(); const db = admin.firestore();
    const [draftsSnapshot, authorsSnapshot] = await Promise.all([
        db.collection('articleDrafts').where('issueId', '==', issueId).get(),
        db.collection('authors').get(),
    ]);
    const directory = authorsSnapshot.docs.map((snapshot) => ({id: snapshot.id, ...snapshot.data()}));
    let ready = 0; let needsReview = 0;
    for (const snapshot of draftsSnapshot.docs) {
        const draft = {id: snapshot.id, ...snapshot.data()};
        if (['published', 'duplicate', 'rejected', 'archived'].includes(draft.status)) continue;
        const authorIds = [...(draft.authorIds || [])]; const authors = [...(draft.authors || [])];
        for (const rawName of draft.unmatchedAuthors || []) {
            const name = String(rawName || '').trim(); if (!name) continue;
            const normalized = normalizeName(name); const firstName = normalized.split(' ')[0];
            let match = directory.find((author) => normalizeName(author.fullName) === normalized);
            if (!match) {
                const fuzzy = directory.filter((author) => normalizeName(author.fullName).split(' ')[0] === firstName && editDistance(author.fullName, name) <= 1);
                if (fuzzy.length === 1) match = fuzzy[0];
            }
            if (!match) {
                const id = `imported-${normalized.replace(/\s+/g, '-').slice(0, 80)}`;
                const record = {id, fullName: name};
                await db.collection('authors').doc(id).set({fullName: name, source: 'issue_spreadsheet', isHidden: false, updatedAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: true});
                directory.push(record); match = record;
            }
            authorIds.push(match.id); authors.push(match.fullName);
        }
        const updatedDraft = {...draft, authorIds: Array.from(new Set(authorIds)), authors: Array.from(new Set(authors)), unmatchedAuthors: []};
        const eligibility = eligibilityForDraft(updatedDraft);
        const status = eligibility.eligible ? 'ready' : 'needs_review';
        if (status === 'ready') ready += 1; else needsReview += 1;
        await snapshot.ref.update({
            authorIds: updatedDraft.authorIds, authors: updatedDraft.authors, unmatchedAuthors: [],
            blockers: eligibility.blockers, status, 'ai.automationEligible': eligibility.eligible,
            automationRecheckedBy: userId, automationRecheckedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    return {ready, needsReview};
};

export const publishReadyIssue = async ({issueId, driveAccessToken, userId}) => {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    const issueRef = db.collection('issues').doc(issueId);
    const [issueSnapshot, draftsSnapshot, articlesSnapshot] = await Promise.all([
        issueRef.get(),
        db.collection('articleDrafts').where('issueId', '==', issueId).get(),
        db.collection('articles').get(),
    ]);
    if (!issueSnapshot.exists) {
        const error = new Error('Issue not found.'); error.status = 404; throw error;
    }
    const drafts = draftsSnapshot.docs.map((snapshot) => ({id: snapshot.id, ref: snapshot.ref, ...snapshot.data()}));
    const candidates = drafts.filter((draft) => !['published', 'duplicate', 'rejected', 'archived'].includes(draft.status));
    const blocked = candidates.map((draft) => ({draft, result: eligibilityForDraft(draft)})).filter((item) => !item.result.eligible);
    const blockedIds = new Set(blocked.map((item) => item.draft.id));
    const publishCandidates = candidates.filter((draft) => !blockedIds.has(draft.id));
    if (!drafts.length || !publishCandidates.length) {
        const error = new Error(!drafts.length ? 'This issue has no prepared stories.' : 'This issue has no ready stories to publish.');
        error.status = 409;
        error.details = blocked.map(({draft, result}) => ({draftId: draft.id, title: draft.title || 'Untitled', blockers: result.blockers}));
        throw error;
    }

    const siteArticles = articlesSnapshot.docs.map((snapshot) => ({id: snapshot.id, ...snapshot.data()}));
    const published = []; const duplicates = []; const mediaFailures = [];
    for (const draft of publishCandidates) {
        const globalMatch = siteArticles.find((article) => normalizeName(article.title) === normalizeName(draft.title));
        if (globalMatch) {
            await draft.ref.update({
                status: 'duplicate', duplicateOfArticleId: globalMatch.id, publishedArticleId: globalMatch.id,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            duplicates.push({draftId: draft.id, articleId: globalMatch.id, title: draft.title});
            continue;
        }
        const articleId = articleIdFor(draft);
        if (!articleId) throw new Error(`Could not create an article ID for “${draft.title || 'Untitled'}”.`);
        const articleRef = db.collection('articles').doc(articleId);
        const existingArticle = await articleRef.get();
        if (existingArticle.exists && existingArticle.data()?.sourceDraftId !== draft.id) {
            const existing = existingArticle.data() || {};
            const sameStory = existing.issueId === issueId
                && existing.date === draft.date
                && String(existing.title || '').trim().toLowerCase() === String(draft.title || '').trim().toLowerCase();
            if (!sameStory) throw new Error(`An unrelated article already uses the ID ${articleId}.`);
            await articleRef.set({sourceDraftId: draft.id}, {merge: true});
            await draft.ref.update({status: 'published', publishedArticleId: articleId, updatedAt: admin.firestore.FieldValue.serverTimestamp()});
            published.push({draftId: draft.id, articleId, existing: true});
            continue;
        }
        const mediaResult = await importDraftMedia({
            draft,
            articleId,
            markdown: draft.markdown || '',
            driveAccessToken,
            userId,
        });
        mediaFailures.push(...mediaResult.failures.map((failure) => ({draftId: draft.id, title: draft.title || 'Untitled', ...failure})));
        const featured = mediaResult.featured;
        const article = {
            status: 'published',
            title: draft.title,
            author: draft.authors || [],
            authorIds: draft.authorIds || [],
            date: draft.date,
            blurb: draft.blurb || '',
            tags: draft.tags || [],
            imageUrl: featured?.url || draft.imageUrl || '',
            featuredImageId: featured?.id || draft.featuredImageId || null,
            size: draft.size || 'normal',
            issueId,
            sourceDraftId: draft.id,
            path: `articles/${articleId}.md`,
            markdown: mediaResult.markdown,
            publishedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        await admin.storage().bucket().file(article.path).save(Buffer.from(mediaResult.markdown, 'utf8'), {contentType: 'text/markdown; charset=utf-8', resumable: false});
        await articleRef.set(article, {merge: true});
        await draft.ref.update({
            status: 'published', publishedArticleId: articleId,
            featuredImageId: featured?.id || draft.featuredImageId || null,
            imageUrl: featured?.url || draft.imageUrl || '',
            markdown: mediaResult.markdown,
            mediaItems: mediaResult.mediaItems,
            publishedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await Promise.all((draft.authorIds || []).map((authorId) => db.collection('authors').doc(authorId).update({
            linkedArticleIds: admin.firestore.FieldValue.arrayUnion(articleId),
            lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
        }).catch((error) => console.warn(`Author link failed for ${authorId}:`, error?.message || error))));
        published.push({draftId: draft.id, articleId});
    }
    await issueRef.update({
        status: 'published',
        publishedAt: issueSnapshot.data()?.publishedAt || admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: userId,
    });
    return {
        published,
        alreadyPublished: drafts.length - candidates.length,
        exceptions: blocked.map(({draft, result}) => ({draftId: draft.id, title: draft.title || 'Untitled', blockers: result.blockers})),
        duplicates,
        mediaFailures,
    };
};
