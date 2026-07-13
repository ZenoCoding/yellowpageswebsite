import {useMemo, useState} from 'react';
import {
    ArrowPathIcon,
    CheckCircleIcon,
    ChevronDownIcon,
    ExclamationTriangleIcon,
    LinkIcon,
    SparklesIcon,
} from '@heroicons/react/24/outline';
import {getApp} from 'firebase/app';
import {getAuth, GoogleAuthProvider, reauthenticateWithPopup} from 'firebase/auth';
import {
    doc,
    getDoc,
    getFirestore,
    serverTimestamp,
    setDoc,
    updateDoc,
} from 'firebase/firestore';
import * as issueSheetImport from '../../lib/issueSheetImport';
import {buildImportMediaItems, stripImportedPublicationHeader} from '../../lib/importHandoff';
import {inspectDriveSource, prepareVisionImages} from '../../lib/manualDriveImport';
import {deriveVerbatimExcerpt, evaluateAutomationEligibility} from '../../lib/articleAutomation';

const DRIVE_TOKEN_STORAGE_KEY = 'yellowpages-drive-readonly-token-v1';
const DRIVE_TOKEN_LIFETIME_MS = 50 * 60 * 1000;
const SHEET_RANGE = 'ARTICLES!A1:J250';
const CONCURRENCY = 2;

const normalizeName = (value = '') => String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
const authorDocumentId = (name) => `imported-${normalizeName(name).replace(/\s+/g, '-').slice(0, 80)}`;
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
const getCandidateKey = (candidate, index) => candidate.key || candidate.driveFileId || candidate.sourceId || `candidate-${index}`;
const candidateUrl = (candidate) => candidate.url || candidate.driveUrl || candidate.sourceUrl || candidate.link || '';
const candidateName = (candidate) => candidate.title || candidate.label || candidate.folderName || candidate.contributor || 'Untitled submission';

const readCachedToken = () => {
    if (typeof window === 'undefined') return null;
    try {
        const cached = JSON.parse(window.sessionStorage.getItem(DRIVE_TOKEN_STORAGE_KEY));
        if (cached?.accessToken && cached?.expiresAt > Date.now()) return cached.accessToken;
    } catch {
        // Reauthorization below is the safe fallback for malformed or expired state.
    }
    window.sessionStorage.removeItem(DRIVE_TOKEN_STORAGE_KEY);
    return null;
};

const cacheToken = (accessToken) => {
    window.sessionStorage.setItem(DRIVE_TOKEN_STORAGE_KEY, JSON.stringify({
        accessToken,
        expiresAt: Date.now() + DRIVE_TOKEN_LIFETIME_MS,
    }));
};

const authorizeGoogle = async () => {
    const user = getAuth().currentUser;
    if (!user) throw new Error('Please sign in again before opening the issue spreadsheet.');
    const provider = new GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/drive.readonly');
    provider.setCustomParameters({login_hint: user.email || ''});
    const result = await reauthenticateWithPopup(user, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) throw new Error('Google did not return a Drive access token.');
    cacheToken(credential.accessToken);
    return credential.accessToken;
};

const withGoogleToken = async (operation) => {
    let token = readCachedToken() || await authorizeGoogle();
    try {
        return await operation(token);
    } catch (error) {
        if (error?.status !== 401) throw error;
        window.sessionStorage.removeItem(DRIVE_TOKEN_STORAGE_KEY);
        token = await authorizeGoogle();
        return operation(token);
    }
};

export const getGoogleDriveAccessToken = () => withGoogleToken(async (token) => token);

const extractSheetId = (source) => {
    if (typeof issueSheetImport.extractSpreadsheetId === 'function') return issueSheetImport.extractSpreadsheetId(source);
    return String(source).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1] || null;
};

const fetchSheet = async (source, accessToken) => {
    const spreadsheetId = extractSheetId(source);
    if (!spreadsheetId) throw new Error('Paste a valid Google Sheets link.');
    const params = new URLSearchParams({
        ranges: SHEET_RANGE,
        includeGridData: 'true',
        fields: 'spreadsheetId,properties.title,sheets(properties(sheetId,title,gridProperties),data(startRow,startColumn,rowData.values(formattedValue,effectiveValue,userEnteredValue,hyperlink,textFormatRuns,chipRuns)))',
    });
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?${params}`, {
        headers: {Authorization: `Bearer ${accessToken}`},
    });
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const details = payload?.error?.message || `Google Sheets request failed (${response.status}).`;
        const error = new Error(/has not been used|accessNotConfigured|disabled/i.test(details)
            ? `${details} Enable the Google Sheets API for the Firebase project, then retry.`
            : details);
        error.status = response.status;
        throw error;
    }
    return {spreadsheetId, payload: await response.json()};
};

const parseSheet = ({payload, month}) => {
    const parser = issueSheetImport.parseIssueSheetMonth;
    if (!parser) throw new Error('The issue spreadsheet parser is unavailable.');
    const result = parser(payload, {month, sheetTitle: 'ARTICLES'});
    return Array.isArray(result) ? {candidates: result, exceptions: []} : result;
};

const matchAuthors = (names, authors) => {
    const byName = new Map((authors || []).map((author) => [normalizeName(author.fullName), author]));
    const ids = [];
    const matchedNames = [];
    const unmatched = [];
    for (const name of names || []) {
        const match = byName.get(normalizeName(name));
        if (match?.id) {
            ids.push(match.id);
            matchedNames.push(match.fullName);
        } else if (String(name).trim()) unmatched.push(String(name).trim());
    }
    return {
        authorIds: Array.from(new Set(ids)),
        authors: Array.from(new Set(matchedNames)),
        unmatchedAuthors: Array.from(new Set(unmatched)),
    };
};

const matchOrCreateSheetAuthors = async (names, authors, db) => {
    const directory = authors || [];
    const authorIds = []; const matchedNames = [];
    for (const rawName of names || []) {
        const name = String(rawName || '').trim(); if (!name) continue;
        const normalized = normalizeName(name);
        let match = directory.find((author) => normalizeName(author.fullName) === normalized);
        if (!match) {
            const firstName = normalized.split(' ')[0];
            const fuzzy = directory.filter((author) => normalizeName(author.fullName).split(' ')[0] === firstName && editDistance(author.fullName, name) <= 1);
            if (fuzzy.length === 1) match = fuzzy[0];
        }
        if (match?.id) {
            authorIds.push(match.id); matchedNames.push(match.fullName); continue;
        }
        const id = authorDocumentId(name);
        await setDoc(doc(db, 'authors', id), {
            fullName: name,
            source: 'issue_spreadsheet',
            isHidden: false,
            updatedAt: serverTimestamp(),
        }, {merge: true});
        authorIds.push(id); matchedNames.push(name);
    }
    return {authorIds: Array.from(new Set(authorIds)), authors: Array.from(new Set(matchedNames)), unmatchedAuthors: []};
};

const statusStyle = {
    queued: 'bg-slate-100 text-slate-600',
    working: 'bg-indigo-50 text-indigo-700',
    imported: 'bg-emerald-50 text-emerald-700',
    existing: 'bg-amber-50 text-amber-800',
    failed: 'bg-rose-50 text-rose-700',
};

export default function IssueBatchImport({issue, issueId, authors = [], existingArticles = [], onImportComplete}) {
    const [expanded, setExpanded] = useState(false);
    const [sheetUrl, setSheetUrl] = useState(issue?.sourceSpreadsheetUrl || 'https://docs.google.com/spreadsheets/d/1h0JrZnRhdDQ_6h-SPZFDUzrbTl0DIUlGdOZddb4qtpQ/edit');
    const [month, setMonth] = useState(issue?.sourceMonth || issue?.name || '');
    const [isScanning, setIsScanning] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const [error, setError] = useState('');
    const [sheetMeta, setSheetMeta] = useState(null);
    const [exceptions, setExceptions] = useState([]);
    const [sheetStatuses, setSheetStatuses] = useState([]);
    const [items, setItems] = useState([]);

    const selectedCount = items.filter((item) => item.selected && !['imported', 'existing'].includes(item.status)).length;
    const counts = useMemo(() => items.reduce((result, item) => ({
        ...result,
        [item.status]: (result[item.status] || 0) + 1,
    }), {}), [items]);

    const updateItem = (key, patch) => setItems((current) => current.map((item) => item.key === key ? {...item, ...patch} : item));

    const handleScan = async (event) => {
        event.preventDefault();
        setError('');
        setIsScanning(true);
        setItems([]);
        setExceptions([]);
        setSheetStatuses([]);
        try {
            const result = await withGoogleToken(async (accessToken) => {
                const fetched = await fetchSheet(sheetUrl, accessToken);
                return {...fetched, parsed: parseSheet({...fetched, month, source: sheetUrl})};
            });
            const candidates = result.parsed?.candidates || [];
            setSheetMeta({spreadsheetId: result.spreadsheetId, title: result.payload?.properties?.title || 'Issue tracker'});
            setExceptions(result.parsed?.exceptions || result.parsed?.warnings || []);
            setSheetStatuses(result.parsed?.statuses || []);
            setItems(candidates.map((candidate, index) => ({
                key: getCandidateKey(candidate, index),
                candidate,
                selected: candidate.importable !== false,
                status: 'queued',
                error: '',
                draftId: '',
            })));
            try {
                await updateDoc(doc(getFirestore(getApp()), 'issues', issueId), {
                    sourceSpreadsheetId: result.spreadsheetId,
                    sourceSpreadsheetUrl: sheetUrl,
                    sourceSheetName: result.parsed?.sheetTitle || 'ARTICLES',
                    sourceMonth: result.parsed?.month?.month || month,
                    updatedAt: serverTimestamp(),
                });
            } catch (saveSourceError) {
                console.error('Unable to remember issue spreadsheet settings', saveSourceError);
            }
            if (!candidates.length) throw new Error(`No importable article links were found under ${month || 'that month'}.`);
        } catch (scanError) {
            setError(scanError?.message || 'Unable to read this issue spreadsheet.');
        } finally {
            setIsScanning(false);
        }
    };

    const importOne = async (item, accessToken, batchId) => {
        const {candidate, key} = item;
        updateItem(key, {status: 'working', error: ''});
        try {
            const inspection = await inspectDriveSource({source: candidateUrl(candidate), accessToken});
            const vision = await prepareVisionImages({inspection, accessToken, maximumImages: 6});
            const firebaseUser = getAuth().currentUser;
            if (!firebaseUser) throw new Error('Your sign-in expired. Sign in and retry this item.');
            const response = await fetch('/api/admin/analyze-article', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${await firebaseUser.getIdToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({submission: {...inspection, visionImages: vision.images, visionWarnings: vision.warnings}}),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) throw new Error(payload?.error || 'AI preparation failed.');

            const analysis = payload.analysis || {};
            const documentId = analysis.selectedDocumentId || inspection.documents?.[0]?.id || inspection.root?.id;
            const selectedDocument = inspection.documents?.find((document) => document.id === documentId) || inspection.documents?.[0];
            const selectedTab = selectedDocument?.tabs?.find((tab) => tab.id === analysis.selectedTabId) || selectedDocument?.tabs?.[0];
            if (!documentId) throw new Error('No readable Google Doc was found in this folder.');
            const articleFolderId = candidate.fileId || inspection.root?.id || documentId;
            const sourceKey = `${issueId}:${articleFolderId}`.replaceAll('/', '%2F');
            const db = getFirestore(getApp());
            const draftRef = doc(db, 'articleDrafts', sourceKey);
            const legacyDraftRef = doc(db, 'articleDrafts', `${documentId}:${selectedTab?.id || 'document'}`.replaceAll('/', '%2F'));
            const existingDraft = await getDoc(draftRef);
            const legacyDraft = existingDraft.exists() ? null : await getDoc(legacyDraftRef);
            const matchedExistingRef = existingDraft.exists() ? draftRef : legacyDraft?.exists() ? legacyDraftRef : null;
            const existingData = matchedExistingRef ? (existingDraft.exists() ? existingDraft.data() : legacyDraft.data()) : null;
            if (matchedExistingRef && existingData?.status === 'published') {
                updateItem(key, {status: 'existing', draftId: matchedExistingRef.id});
                return {status: 'existing', draftId: matchedExistingRef.id};
            }
            const targetDraftRef = matchedExistingRef || draftRef;

            const sheetAuthorResult = await matchOrCreateSheetAuthors(candidate.contributors || [candidate.contributor], authors, db);
            const aiAuthorResult = matchAuthors(analysis.authors || [], authors);
            const authorResult = sheetAuthorResult.authorIds.length ? sheetAuthorResult : aiAuthorResult;
            const aiDisagreesWithSheet = sheetAuthorResult.authorIds.length > 0 && aiAuthorResult.authorIds.length > 0
                && aiAuthorResult.authorIds.some((authorId) => !sheetAuthorResult.authorIds.includes(authorId));
            const markdown = stripImportedPublicationHeader({
                markdown: analysis.articleMarkdown || '',
                title: analysis.title || '',
                authors: analysis.authors || [],
            });
            const mediaItems = buildImportMediaItems(inspection, analysis, payload.imageSources || []);
            const blurb = deriveVerbatimExcerpt(markdown);
            const eligibility = evaluateAutomationEligibility({
                title: analysis.title,
                authorIds: authorResult.authorIds,
                unmatchedAuthors: authorResult.unmatchedAuthors,
                date: issue?.targetPublicationDate,
                tags: analysis.suggestedTags,
                markdown,
                analysis,
                inputTruncated: Boolean(payload.sourceMeta?.inputTruncated),
            });
            const blockers = eligibility.blockers;
            const matchingPublishedArticle = existingArticles.find((article) =>
                normalizeName(article.title) === normalizeName(analysis.title)
            );
            const duplicateAcrossIssues = matchingPublishedArticle && matchingPublishedArticle.issueId !== issueId;
            await setDoc(targetDraftRef, {
                status: duplicateAcrossIssues ? 'duplicate' : matchingPublishedArticle ? 'published' : eligibility.eligible ? 'ready' : 'needs_review',
                title: analysis.title || candidateName(candidate),
                authors: authorResult.authors,
                authorIds: authorResult.authorIds,
                unmatchedAuthors: authorResult.unmatchedAuthors,
                date: issue?.targetPublicationDate || '',
                publicationDate: issue?.targetPublicationDate || '',
                blurb,
                tags: analysis.suggestedTags || [],
                imageUrl: '',
                featuredImageId: '',
                size: 'normal',
                markdown,
                issueId,
                importBatchId: batchId,
                sourceKey,
                mediaItems,
                blockers,
                publishedArticleId: matchingPublishedArticle?.id || null,
                duplicateOfArticleId: duplicateAcrossIssues ? matchingPublishedArticle.id : null,
                source: {
                    type: 'google_drive',
                    rootId: inspection.root?.id || null,
                    articleFolderId,
                    rootName: inspection.root?.name || '',
                    url: inspection.root?.webViewLink || candidateUrl(candidate),
                    documentId,
                    documentName: selectedDocument?.name || '',
                    tabId: selectedTab?.id || null,
                    tabTitle: selectedTab?.title || '',
                    modifiedTime: selectedDocument?.modifiedTime || null,
                    spreadsheetId: sheetMeta?.spreadsheetId || null,
                    spreadsheetRange: candidate.sourceCells?.map((cell) => cell.range).filter(Boolean).join(', ') || candidate.range || candidate.cell || null,
                    issueImportBatchId: batchId,
                    lastCheckedAt: serverTimestamp(),
                },
                ai: {
                    model: payload.model || '',
                    readiness: analysis.readiness || 'needs_review',
                    confidence: analysis.confidence ?? null,
                    selectionReason: analysis.selectionReason || '',
                    warnings: analysis.warnings || [],
                    editorialNotes: analysis.editorialNotes || [],
                    removedMaterial: analysis.removedMaterial || [],
                    spreadsheetBylineMismatch: aiDisagreesWithSheet,
                    inputTruncated: Boolean(payload.sourceMeta?.inputTruncated),
                    automationEligible: eligibility.eligible,
                },
                createdBy: firebaseUser.uid,
                createdByName: firebaseUser.displayName || firebaseUser.email || '',
                createdAt: existingData?.createdAt || serverTimestamp(),
                updatedAt: serverTimestamp(),
            }, {merge: true});
            const resultStatus = matchingPublishedArticle ? 'existing' : 'imported';
            updateItem(key, {status: resultStatus, draftId: targetDraftRef.id});
            return {status: resultStatus, draftId: targetDraftRef.id};
        } catch (itemError) {
            updateItem(key, {status: 'failed', error: itemError?.message || 'Import failed.'});
            return {status: 'failed', error: itemError?.message || 'Import failed.'};
        }
    };

    const runImport = async (onlyFailed = false) => {
        if (isRunning) return;
        setError('');
        setIsRunning(true);
        try {
            const accessToken = await withGoogleToken(async (token) => token);
            const queue = items.filter((item) => onlyFailed ? item.status === 'failed' : item.selected && !['imported', 'existing'].includes(item.status));
            if (!queue.length) throw new Error('Select at least one article to prepare.');
            const db = getFirestore(getApp());
            const batchId = `${issueId}-${Date.now()}`;
            const batchRef = doc(db, 'importBatches', batchId);
            await setDoc(batchRef, {
                issueId,
                status: 'running',
                spreadsheetId: sheetMeta?.spreadsheetId || null,
                spreadsheetUrl: sheetUrl,
                spreadsheetRange: SHEET_RANGE,
                month,
                totalCount: queue.length,
                importedCount: 0,
                existingCount: 0,
                failedCount: 0,
                createdBy: getAuth().currentUser?.uid || null,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            const results = [];
            let nextIndex = 0;
            const worker = async () => {
                while (nextIndex < queue.length) {
                    const item = queue[nextIndex++];
                    results.push(await importOne(item, accessToken, batchId));
                }
            };
            await Promise.all(Array.from({length: Math.min(CONCURRENCY, queue.length)}, worker));
            const totals = results.reduce((result, item) => ({...result, [item.status]: (result[item.status] || 0) + 1}), {});
            await updateDoc(batchRef, {
                status: totals.failed ? 'partial' : 'completed',
                importedCount: totals.imported || 0,
                existingCount: totals.existing || 0,
                failedCount: totals.failed || 0,
                completedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            onImportComplete?.({batchId, ...totals});
        } catch (runError) {
            setError(runError?.message || 'Unable to start this issue import.');
        } finally {
            setIsRunning(false);
        }
    };

    return (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <button type="button" onClick={() => setExpanded((value) => !value)} className="flex w-full items-center justify-between gap-5 px-6 py-5 text-left hover:bg-slate-50">
                <span className="flex items-center gap-4">
                    <span className="rounded-xl bg-indigo-50 p-3 text-indigo-600"><SparklesIcon className="h-6 w-6"/></span>
                    <span>
                        <span className="block font-semibold text-slate-900">Import the whole issue</span>
                        <span className="mt-1 block text-sm text-slate-500">Scan the tracker and prepare its submissions.</span>
                    </span>
                </span>
                <ChevronDownIcon className={`h-5 w-5 text-slate-400 transition ${expanded ? 'rotate-180' : ''}`}/>
            </button>

            {expanded && <div className="border-t border-slate-200 px-6 py-6">
                <form onSubmit={handleScan} className="grid gap-4 lg:grid-cols-[1fr_14rem_auto] lg:items-end">
                    <label className="block text-sm font-medium text-slate-700">
                        Article tracker spreadsheet
                        <span className="relative mt-2 block">
                            <LinkIcon className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-slate-400"/>
                            <input required type="url" value={sheetUrl} onChange={(event) => setSheetUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" className="w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-3 text-sm focus:border-indigo-500 focus:ring-indigo-500"/>
                        </span>
                    </label>
                    <label className="block text-sm font-medium text-slate-700">
                        Month column
                        <input required value={month} onChange={(event) => setMonth(event.target.value)} placeholder="February" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:ring-indigo-500"/>
                    </label>
                    <button disabled={isScanning || isRunning} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
                        {isScanning && <ArrowPathIcon className="h-4 w-4 animate-spin"/>} Preview issue
                    </button>
                </form>

                {error && <div className="mt-5 flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><ExclamationTriangleIcon className="h-5 w-5 shrink-0"/><p>{error}</p></div>}

                {exceptions.length > 0 && <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <p className="font-semibold text-amber-900">Spreadsheet exceptions ({exceptions.length})</p>
                    <ul className="mt-2 space-y-1 text-sm text-amber-800">
                        {exceptions.slice(0, 12).map((exception, index) => <li key={`${exception.cell || index}-${exception.reason || exception}`}>• {exception.label || exception.contributor || exception.cell || exception.message || exception.reason || String(exception)}</li>)}
                    </ul>
                </div>}

                {sheetStatuses.length > 0 && <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="font-semibold text-slate-900">Not queued ({sheetStatuses.length})</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                        {sheetStatuses.slice(0, 20).map((entry, index) => <span key={`${entry.sourceCell?.range || index}-${entry.status}`} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">{entry.contributor || entry.sourceCell?.range}: {entry.status.replaceAll('_', ' ')}</span>)}
                    </div>
                </div>}

                {items.length > 0 && <div className="mt-6">
                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                        <div>
                            <p className="font-semibold text-slate-900">{sheetMeta?.title} · {month}</p>
                            <p className="mt-1 text-sm text-slate-500">{items.length} linked submission{items.length === 1 ? '' : 's'}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {(counts.failed || 0) > 0 && <button type="button" disabled={isRunning} onClick={() => runImport(true)} className="rounded-lg border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Retry {counts.failed} failed</button>}
                            <button type="button" disabled={isRunning || !selectedCount} onClick={() => runImport(false)} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
                                {isRunning && <ArrowPathIcon className="h-4 w-4 animate-spin"/>} Prepare {selectedCount} draft{selectedCount === 1 ? '' : 's'}
                            </button>
                        </div>
                    </div>

                    <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
                        {items.map((item) => <div key={item.key} className="flex items-start gap-4 p-4">
                            <input type="checkbox" checked={item.selected} disabled={isRunning || ['imported', 'existing'].includes(item.status)} onChange={(event) => updateItem(item.key, {selected: event.target.checked})} className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"/>
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-medium text-slate-900">{candidateName(item.candidate)}</p>
                                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyle[item.status]}`}>{item.status}</span>
                                </div>
                                <p className="mt-1 truncate text-sm text-slate-500">{item.candidate.contributors?.join(', ') || item.candidate.contributor || item.candidate.sourceCells?.map((cell) => cell.range).join(', ') || item.candidate.cell || candidateUrl(item.candidate)}</p>
                                {item.error && <p className="mt-2 text-sm text-rose-700">{item.error}</p>}
                                {item.draftId && <a href={`/upload?draftId=${encodeURIComponent(item.draftId)}`} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-indigo-600 hover:text-indigo-700">Open draft <span aria-hidden="true">→</span></a>}
                            </div>
                            {item.status === 'imported' && <CheckCircleIcon className="h-5 w-5 shrink-0 text-emerald-500"/>}
                        </div>)}
                    </div>
                </div>}
            </div>}
        </section>
    );
}
