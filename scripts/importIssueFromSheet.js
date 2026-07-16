import 'dotenv/config';
import {GoogleAuth} from 'google-auth-library';
import {parseIssueSheetMonth} from '../lib/issueSheetImport.js';
import {inspectDriveSource, prepareVisionImages} from '../lib/manualDriveImport.js';
import {analyzeArticleSubmission} from '../lib/server/articleAnalysis.js';
import {getFirebaseAdmin} from '../lib/server/firebaseAdmin.js';
import {buildImportMediaItems, stripImportedPublicationHeader} from '../lib/importHandoff.js';
import {deriveVerbatimExcerpt, evaluateAutomationEligibility, isClosedDraftStatus} from '../lib/articleAutomation.js';
import {publishReadyIssue} from '../lib/server/publishIssue.js';

const DEFAULT_SPREADSHEET_ID = '1h0JrZnRhdDQ_6h-SPZFDUzrbTl0DIUlGdOZddb4qtpQ';
const SHEET_RANGE = 'ARTICLES!A1:J250';
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
    if (!value.startsWith('--')) return pairs;
    const key = value.slice(2);
    const next = values[index + 1];
    pairs.push([key, !next || next.startsWith('--') ? true : next]);
    return pairs;
}, []));

const required = (name) => {
    const value = args[name];
    if (!value || value === true) throw new Error(`--${name} is required.`);
    return String(value);
};
const normalizeName = (value = '') => String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const slugify = (value = '') => normalizeName(value).replace(/\s+/g, '-');
const sourceUrl = (candidate) => candidate.url || candidate.driveUrl || candidate.sourceUrl || '';
const cleanForFirestore = (value) => JSON.parse(JSON.stringify(value));

const loadServiceAccount = () => {
    const source = String(process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
    if (!source) throw new Error('FIREBASE_SERVICE_ACCOUNT is required.');
    if (source.includes('{')) return JSON.parse(source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1));
    throw new Error('The issue importer expects FIREBASE_SERVICE_ACCOUNT JSON in .env.');
};

const getGoogleAccess = async () => {
    const auth = new GoogleAuth({
        credentials: loadServiceAccount(),
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets.readonly',
            'https://www.googleapis.com/auth/drive.readonly',
        ],
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (!token?.token) throw new Error('Google did not return an access token.');
    return {headers: await auth.getRequestHeaders(), accessToken: token.token};
};

const fetchSheet = async ({spreadsheetId, headers}) => {
    const params = new URLSearchParams({
        ranges: SHEET_RANGE,
        includeGridData: 'true',
        fields: 'spreadsheetId,properties.title,sheets(properties(sheetId,title,gridProperties),data(startRow,startColumn,rowData.values(formattedValue,effectiveValue,userEnteredValue,hyperlink,textFormatRuns,chipRuns)))',
    });
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?${params}`, {headers});
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || `Google Sheets request failed (${response.status}).`);
    return payload;
};

const getOrCreateIssue = async ({db, admin, issueId, issueName, issueNumber, date, sourceMonth, spreadsheetId, execute}) => {
    if (issueId) {
        const snapshot = await db.collection('issues').doc(issueId).get();
        if (!snapshot.exists) throw new Error(`Issue ${issueId} was not found.`);
        return {id: snapshot.id, ...snapshot.data()};
    }
    const issues = await db.collection('issues').get();
    const existing = issues.docs.find((snapshot) => {
        const issue = snapshot.data();
        return issue.schoolYear === '2025-26' && Number(issue.issueNumber) === Number(issueNumber);
    });
    if (existing) return {id: existing.id, ...existing.data()};
    if (!execute) return {id: '(new issue)', name: issueName, issueNumber: Number(issueNumber), targetPublicationDate: date};
    const ref = db.collection('issues').doc();
    const record = {
        name: issueName,
        slug: `${date.slice(0, 7)}-${slugify(issueName.replace(/\s+20\d{2}$/, ''))}-2025-26`,
        schoolYear: '2025-26',
        volumeNumber: 5,
        issueNumber: Number(issueNumber),
        targetPublicationDate: date,
        status: 'planning',
        sourceSpreadsheetId: spreadsheetId,
        sourceSpreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        sourceSheetName: 'ARTICLES',
        sourceMonth,
        createdBy: 'service-issue-import',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await ref.set(record);
    return {id: ref.id, ...record};
};

const authorDirectory = async (db) => {
    const snapshot = await db.collection('authors').get();
    return snapshot.docs.map((item) => ({id: item.id, ...item.data()}));
};

const matchOrCreateAuthors = async ({names, directory, db, admin}) => {
    const authorIds = []; const authors = [];
    for (const rawName of names || []) {
        const name = String(rawName || '').trim();
        if (!name) continue;
        const normalized = normalizeName(name);
        let match = directory.find((author) => normalizeName(author.fullName) === normalized);
        if (!match) {
            const id = `imported-${slugify(name).slice(0, 80)}`;
            match = {id, fullName: name};
            await db.collection('authors').doc(id).set({
                fullName: name,
                source: 'issue_spreadsheet',
                isHidden: false,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, {merge: true});
            directory.push(match);
        }
        authorIds.push(match.id); authors.push(match.fullName);
    }
    return {authorIds: [...new Set(authorIds)], authors: [...new Set(authors)], unmatchedAuthors: []};
};

const importCandidate = async ({candidate, issue, batchRef, db, admin, directory, accessToken, spreadsheetId, publishedSources}) => {
    const itemId = (candidate.fileId || candidate.key).replaceAll('/', '%2F');
    const itemRef = batchRef.collection('items').doc(itemId);
    const sourceKey = `${issue.id}:${candidate.fileId}`.replaceAll('/', '%2F');
    const draftRef = db.collection('articleDrafts').doc(sourceKey);
    const existing = await draftRef.get();
    const existingData = existing.exists ? existing.data() : null;

    const canonical = publishedSources.get(candidate.fileId);
    if (!existing.exists && canonical) {
        await draftRef.set({
            status: 'duplicate',
            title: canonical.title || candidate.label || 'Duplicate submission',
            issueId: issue.id,
            date: issue.targetPublicationDate,
            publicationDate: issue.targetPublicationDate,
            duplicateOfArticleId: canonical.articleId,
            publishedArticleId: canonical.articleId,
            source: {type: 'google_drive', articleFolderId: candidate.fileId, url: sourceUrl(candidate), spreadsheetId, spreadsheetRange: candidate.sourceCells?.map((cell) => cell.range).join(', ') || null},
            createdBy: 'service-issue-import',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await itemRef.set({status: 'duplicate', draftId: draftRef.id, articleId: canonical.articleId, candidate: cleanForFirestore(candidate), updatedAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: true});
        return {status: 'duplicate', draftId: draftRef.id, title: canonical.title || candidate.label};
    }

    await itemRef.set({status: 'working', candidate: cleanForFirestore(candidate), updatedAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: true});
    try {
        const inspection = await inspectDriveSource({source: sourceUrl(candidate), accessToken});
        const inspectedSource = inspection.documents?.find((document) => document.id === existingData?.source?.documentId)
            || inspection.pdfFiles?.find((file) => file.id === existingData?.source?.documentId)
            || inspection.documents?.[0]
            || inspection.pdfFiles?.[0]
            || inspection.root;
        const inspectedModifiedTime = inspectedSource?.modifiedTime || null;
        if (existingData && inspectedModifiedTime && inspectedModifiedTime === existingData.source?.modifiedTime) {
            await draftRef.update({'source.lastCheckedAt': admin.firestore.FieldValue.serverTimestamp(), lastImportBatchId: batchRef.id});
            await itemRef.set({status: 'existing', draftId: draftRef.id, candidate: cleanForFirestore(candidate), completedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: true});
            return {status: 'existing', draftId: draftRef.id, title: existingData.title || candidate.label};
        }
        const vision = await prepareVisionImages({inspection, accessToken, maximumImages: 6});
        const payload = await analyzeArticleSubmission({
            submission: {...inspection, visionImages: vision.images, visionWarnings: vision.warnings},
            userId: 'service-issue-import',
        });
        const analysis = payload.analysis || {};
        const documentId = analysis.selectedDocumentId || inspection.documents?.[0]?.id || inspection.pdfFiles?.[0]?.id || inspection.root?.id;
        const selectedDocument = inspection.documents?.find((document) => document.id === documentId) || inspection.documents?.[0];
        const selectedPdf = inspection.pdfFiles?.find((file) => file.id === documentId) || inspection.pdfFiles?.[0];
        const selectedTab = selectedDocument?.tabs?.find((tab) => tab.id === analysis.selectedTabId) || selectedDocument?.tabs?.[0];
        if (!documentId) throw new Error('No readable article document was found.');
        const byline = await matchOrCreateAuthors({names: candidate.contributors, directory, db, admin});
        const markdown = stripImportedPublicationHeader({
            markdown: analysis.articleMarkdown || '',
            title: analysis.title || '',
            authors: analysis.authors || [],
        });
        const aiNames = new Set((analysis.authors || []).map(normalizeName).filter(Boolean));
        const sheetNames = new Set((byline.authors || []).map(normalizeName).filter(Boolean));
        const bylineMismatch = aiNames.size > 0
            && (aiNames.size !== sheetNames.size || [...aiNames].some((name) => !sheetNames.has(name)));
        const ai = {
            model: payload.model || '',
            readiness: analysis.readiness || 'needs_review',
            confidence: analysis.confidence ?? null,
            selectionReason: analysis.selectionReason || '',
            warnings: analysis.warnings || [],
            editorialNotes: analysis.editorialNotes || [],
            removedMaterial: analysis.removedMaterial || [],
            detectedAuthors: analysis.authors || [],
            spreadsheetBylineMismatch: bylineMismatch,
            inputTruncated: Boolean(payload.sourceMeta?.inputTruncated),
        };
        const eligibility = evaluateAutomationEligibility({
            title: analysis.title,
            authorIds: byline.authorIds,
            unmatchedAuthors: [],
            date: issue.targetPublicationDate,
            tags: analysis.suggestedTags,
            markdown,
            analysis: ai,
            inputTruncated: ai.inputTruncated,
        });
        ai.automationEligible = eligibility.eligible;
        const mediaItems = buildImportMediaItems(inspection, analysis, payload.imageSources || []);
        if (existingData) {
            const sourceRevision = cleanForFirestore({
                status: 'pending',
                modifiedTime: selectedDocument?.modifiedTime || selectedPdf?.modifiedTime || inspectedModifiedTime || null,
                title: analysis.title || candidate.label || 'Untitled story',
                authors: byline.authors,
                authorIds: byline.authorIds,
                unmatchedAuthors: [],
                blurb: deriveVerbatimExcerpt(markdown),
                tags: analysis.suggestedTags || [],
                markdown,
                mediaItems,
                ai,
            });
            await draftRef.update({
                status: isClosedDraftStatus(existingData.status) ? existingData.status : 'needs_review',
                blockers: Array.from(new Set([...(existingData.blockers || []), 'source changed since import'])),
                reviewedBlockers: (existingData.reviewedBlockers || []).filter((blocker) => blocker !== 'source changed since import'),
                sourceRevision: {...sourceRevision, preparedAt: admin.firestore.FieldValue.serverTimestamp()},
                'source.pendingModifiedTime': sourceRevision.modifiedTime,
                'source.lastCheckedAt': admin.firestore.FieldValue.serverTimestamp(),
                lastImportBatchId: batchRef.id,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            await itemRef.set({status: 'changed', draftId: draftRef.id, title: sourceRevision.title, completedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: true});
            return {status: 'changed', draftId: draftRef.id, title: sourceRevision.title, blockers: ['source changed since import']};
        }
        await draftRef.set({
            status: eligibility.eligible ? 'ready' : 'needs_review',
            title: analysis.title || candidate.label || 'Untitled story',
            authors: byline.authors,
            authorIds: byline.authorIds,
            unmatchedAuthors: [],
            date: issue.targetPublicationDate,
            publicationDate: issue.targetPublicationDate,
            blurb: deriveVerbatimExcerpt(markdown),
            tags: analysis.suggestedTags || [],
            imageUrl: '',
            featuredImageId: '',
            size: 'normal',
            markdown,
            issueId: issue.id,
            importBatchId: batchRef.id,
            sourceKey,
            mediaItems,
            blockers: eligibility.blockers,
            reviewedBlockers: [],
            source: {
                type: 'google_drive',
                rootId: inspection.root?.id || null,
                articleFolderId: candidate.fileId || inspection.root?.id || documentId,
                rootName: inspection.root?.name || '',
                url: inspection.root?.webViewLink || sourceUrl(candidate),
                documentId,
                documentName: selectedDocument?.name || selectedPdf?.name || '',
                tabId: selectedTab?.id || null,
                tabTitle: selectedTab?.title || '',
                modifiedTime: selectedDocument?.modifiedTime || selectedPdf?.modifiedTime || null,
                spreadsheetId,
                spreadsheetRange: candidate.sourceCells?.map((cell) => cell.range).join(', ') || null,
                issueImportBatchId: batchRef.id,
                lastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            ai,
            createdBy: 'service-issue-import',
            createdByName: 'Issue importer',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await itemRef.set({status: 'imported', draftId: draftRef.id, title: analysis.title || candidate.label, blockers: eligibility.blockers, completedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: true});
        return {status: 'imported', draftId: draftRef.id, title: analysis.title || candidate.label, blockers: eligibility.blockers};
    } catch (error) {
        await itemRef.set({status: 'failed', error: error?.message || 'Import failed.', completedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: true});
        return {status: 'failed', title: candidate.label, error: error?.message || 'Import failed.'};
    }
};

const main = async () => {
    const sourceMonth = required('month');
    const spreadsheetId = String(args['spreadsheet-id'] || DEFAULT_SPREADSHEET_ID);
    const execute = Boolean(args.execute);
    const {headers, accessToken} = await getGoogleAccess();
    const sheet = await fetchSheet({spreadsheetId, headers});
    const parsed = parseIssueSheetMonth(sheet, {month: sourceMonth, sheetTitle: 'ARTICLES'});
    const admin = getFirebaseAdmin(); const db = admin.firestore();
    const issue = await getOrCreateIssue({
        db, admin,
        issueId: args['issue-id'] && String(args['issue-id']),
        issueName: args['issue-name'] ? String(args['issue-name']) : `${sourceMonth} issue`,
        issueNumber: required('issue-number'),
        date: required('date'),
        sourceMonth,
        spreadsheetId,
        execute,
    });
    console.log(JSON.stringify({mode: execute ? 'execute' : 'dry-run', issue: {id: issue.id, name: issue.name, date: issue.targetPublicationDate}, sourceMonth, summary: parsed.summary, candidates: parsed.candidates.map((candidate) => ({contributors: candidate.contributors, label: candidate.label, fileId: candidate.fileId}))}, null, 2));
    if (!execute) return;

    const batchRef = db.collection('importBatches').doc(`${issue.id}-${Date.now()}`);
    await batchRef.set({
        issueId: issue.id,
        status: 'running',
        spreadsheetId,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        spreadsheetRange: SHEET_RANGE,
        month: sourceMonth,
        totalCount: parsed.candidates.length,
        importedCount: 0,
        existingCount: 0,
        changedCount: 0,
        failedCount: 0,
        createdBy: 'service-issue-import',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const directory = await authorDirectory(db);
    const allDrafts = await db.collection('articleDrafts').get();
    const publishedSources = new Map(allDrafts.docs.map((snapshot) => ({id: snapshot.id, ...snapshot.data()}))
        .filter((draft) => draft.source?.articleFolderId && draft.publishedArticleId && ['published', 'duplicate'].includes(draft.status))
        .map((draft) => [draft.source.articleFolderId, {articleId: draft.publishedArticleId, title: draft.title}]));
    const results = [];
    const concurrency = Math.max(1, Math.min(3, Number(args.concurrency || 2)));
    let nextIndex = 0;
    const worker = async () => {
        while (nextIndex < parsed.candidates.length) {
            const candidate = parsed.candidates[nextIndex++];
            const result = await importCandidate({candidate, issue, batchRef, db, admin, directory, accessToken, spreadsheetId, publishedSources});
            results.push(result);
            console.log(`${result.status}: ${result.title || candidate.label}${result.error ? ` — ${result.error}` : ''}${result.blockers?.length ? ` — ${result.blockers.join(', ')}` : ''}`);
        }
    };
    await Promise.all(Array.from({length: Math.min(concurrency, parsed.candidates.length)}, worker));
    const counts = results.reduce((output, result) => ({...output, [result.status]: (output[result.status] || 0) + 1}), {});
    await batchRef.update({
        status: counts.failed ? 'partial' : 'completed',
        importedCount: counts.imported || 0,
        existingCount: counts.existing || 0,
        changedCount: counts.changed || 0,
        failedCount: counts.failed || 0,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(JSON.stringify({batchId: batchRef.id, counts, needsReview: results.filter((result) => result.blockers?.length), failures: results.filter((result) => result.error)}, null, 2));
    if (args.publish) {
        const publication = await publishReadyIssue({issueId: issue.id, driveAccessToken: accessToken, userId: 'service-issue-import'});
        console.log(JSON.stringify({publication}, null, 2));
    }
};

main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
});
