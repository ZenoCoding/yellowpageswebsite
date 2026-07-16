import crypto from 'crypto';
import {getFirebaseAdmin} from './firebaseAdmin';
import {getRemainingDraftBlockers, isClosedDraftStatus} from '../articleAutomation';
import {insertInlineImageTokens, normalizeAutomaticMediaItems} from '../articleMediaPlacement';

const articleIdFor = (draft) => {
    const slug = String(draft.title || '')
        .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
    return draft.date && slug ? `${draft.date}_${slug}` : null;
};

const normalizeName = (value = '') => String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
const draftSourceId = (draft = {}) => draft.source?.articleFolderId || draft.source?.rootId || draft.source?.documentId || null;
const contentFingerprint = (draft = {}) => crypto.createHash('sha256').update(JSON.stringify({
    body: String(draft.markdown || '').replace(/\s+/g, ' ').trim().toLowerCase(),
    authors: [...(draft.authorIds || draft.authors || [])].map(normalizeName).sort(),
})).digest('hex');
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
    const sourceHash = crypto.createHash('sha256').update(`${articleId}:${media.sourceKind || ''}:${media.sourceId || media.sourceName || ''}`).digest('hex').slice(0, 24);
    const imageRef = admin.firestore().collection('images').doc(`imported-${sourceHash}`);
    const deterministicImage = await imageRef.get();
    if (deterministicImage.exists) {
        await imageRef.set({linkedArticleIds: admin.firestore.FieldValue.arrayUnion(articleId), lastUsedAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: true});
        return {id: imageRef.id, ...deterministicImage.data(), newlyImported: false};
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
    const storagePath = `article-images/${articleId}-${sourceHash}.${extension}`;
    const bucket = admin.storage().bucket();
    await bucket.file(storagePath).save(Buffer.from(await response.arrayBuffer()), {
        contentType,
        resumable: false,
        metadata: {metadata: {firebaseStorageDownloadTokens: token}},
    });
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

const eligibilityForDraft = (draft) => {
    const blockers = getRemainingDraftBlockers(draft, draft);
    return {eligible: blockers.length === 0, blockers};
};

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
        if (isClosedDraftStatus(draft.status)) continue;
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
    const [issueSnapshot, allDraftsSnapshot, articlesSnapshot] = await Promise.all([
        issueRef.get(),
        db.collection('articleDrafts').get(),
        db.collection('articles').get(),
    ]);
    if (!issueSnapshot.exists) {
        const error = new Error('Issue not found.'); error.status = 404; throw error;
    }
    const allDrafts = allDraftsSnapshot.docs.map((snapshot) => ({id: snapshot.id, ref: snapshot.ref, ...snapshot.data()}));
    const drafts = allDrafts.filter((draft) => draft.issueId === issueId);
    const siteArticles = articlesSnapshot.docs.map((snapshot) => ({id: snapshot.id, ...snapshot.data()}));
    const draftById = new Map(allDrafts.map((draft) => [draft.id, draft]));
    const duplicates = [];
    const initialCandidates = drafts.filter((draft) => !isClosedDraftStatus(draft.status));
    const duplicateDraftIds = new Set();
    for (const draft of initialCandidates) {
        const sourceId = draftSourceId(draft);
        const sourceMatch = sourceId && siteArticles.find((article) => draftSourceId(draftById.get(article.sourceDraftId)) === sourceId);
        if (!sourceMatch) continue;
        duplicateDraftIds.add(draft.id);
        await draft.ref.update({status: 'duplicate', duplicateOfArticleId: sourceMatch.id, publishedArticleId: sourceMatch.id, updatedAt: admin.firestore.FieldValue.serverTimestamp()});
        duplicates.push({draftId: draft.id, articleId: sourceMatch.id, title: draft.title});
    }
    const candidates = initialCandidates.filter((draft) => !duplicateDraftIds.has(draft.id));
    const blocked = candidates.map((draft) => ({draft, result: eligibilityForDraft(draft)})).filter((item) => !item.result.eligible);
    if (!drafts.length || blocked.length || !candidates.length) {
        const error = new Error(!drafts.length
            ? 'This issue has no prepared stories.'
            : blocked.length
                ? `Resolve ${blocked.length} ${blocked.length === 1 ? 'story' : 'stories'} before publishing the issue.`
                : 'This issue has no unpublished stories.');
        error.status = 409;
        error.details = blocked.map(({draft, result}) => ({draftId: draft.id, title: draft.title || 'Untitled', blockers: result.blockers}));
        throw error;
    }
    const seenArticleIds = new Map(siteArticles.map((article) => [article.id, article]));
    const candidatePlans = []; const plannedByArticleId = new Map();
    for (const draft of candidates) {
        const articleId = articleIdFor(draft);
        if (!articleId) throw new Error(`Could not create an article ID for “${draft.title || 'Untitled'}”.`);
        const collision = seenArticleIds.get(articleId);
        if (collision && collision.sourceDraftId !== draft.id) {
            const collisionDraft = draftById.get(collision.sourceDraftId) || collision;
            if (contentFingerprint(collisionDraft) === contentFingerprint(draft)) {
                await draft.ref.update({status: 'duplicate', duplicateOfArticleId: collision.id, publishedArticleId: collision.id, updatedAt: admin.firestore.FieldValue.serverTimestamp()});
                duplicates.push({draftId: draft.id, articleId: collision.id, title: draft.title});
                continue;
            }
            const error = new Error(`Two different stories would use the same article ID: “${draft.title}”. Change one headline before publishing.`);
            error.status = 409;
            throw error;
        }
        const plannedCollision = plannedByArticleId.get(articleId);
        if (plannedCollision) {
            if (contentFingerprint(plannedCollision.draft) === contentFingerprint(draft)) {
                await draft.ref.update({status: 'duplicate', duplicateOfArticleId: articleId, publishedArticleId: articleId, updatedAt: admin.firestore.FieldValue.serverTimestamp()});
                duplicates.push({draftId: draft.id, articleId, title: draft.title});
                continue;
            }
            const error = new Error(`Two different stories would use the same article ID: “${draft.title}”. Change one headline before publishing.`);
            error.status = 409;
            throw error;
        }
        const plan = {draft, articleId, articleRef: db.collection('articles').doc(articleId)};
        plannedByArticleId.set(articleId, plan);
        candidatePlans.push(plan);
    }

    const prepared = []; const mediaFailures = [];
    for (const plan of candidatePlans) {
        const {draft, articleId, articleRef} = plan;
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
        prepared.push({draft, articleId, articleRef, article, mediaResult, featured});
    }

    const existingIssueArticleCount = siteArticles.filter((article) => article.issueId === issueId).length;
    if (!prepared.length && !existingIssueArticleCount) {
        const error = new Error('No stories were published, so the issue remains unpublished.');
        error.status = 409;
        throw error;
    }

    await db.runTransaction(async (transaction) => {
        const [freshIssue, ...freshArticles] = await Promise.all([
            transaction.get(issueRef),
            ...prepared.map(({articleRef}) => transaction.get(articleRef)),
        ]);
        if (!freshIssue.exists) throw new Error('Issue not found.');
        freshArticles.forEach((snapshot, index) => {
            if (snapshot.exists && snapshot.data()?.sourceDraftId !== prepared[index].draft.id) {
                const error = new Error(`An unrelated article already uses the ID ${prepared[index].articleId}. Change the headline before publishing.`);
                error.status = 409;
                throw error;
            }
        });
        const authorLinks = new Map();
        for (const {draft, articleId, articleRef, article, mediaResult, featured} of prepared) {
            transaction.set(articleRef, article, {merge: true});
            transaction.update(draft.ref, {
            status: 'published', publishedArticleId: articleId,
            featuredImageId: featured?.id || draft.featuredImageId || null,
            imageUrl: featured?.url || draft.imageUrl || '',
            markdown: mediaResult.markdown,
            mediaItems: mediaResult.mediaItems,
            publishedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            for (const authorId of draft.authorIds || []) {
                const linked = authorLinks.get(authorId) || [];
                linked.push(articleId); authorLinks.set(authorId, linked);
            }
        }
        for (const [authorId, articleIds] of authorLinks) {
            transaction.set(db.collection('authors').doc(authorId), {
            linkedArticleIds: admin.firestore.FieldValue.arrayUnion(...articleIds),
            lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, {merge: true});
        }
        transaction.update(issueRef, {
        status: 'published',
        publishedAt: freshIssue.data()?.publishedAt || admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: userId,
        });
    });
    const published = prepared.map(({draft, articleId}) => ({draftId: draft.id, articleId}));
    return {
        published,
        alreadyPublished: drafts.length - candidates.length,
        exceptions: [],
        duplicates,
        mediaFailures,
    };
};
