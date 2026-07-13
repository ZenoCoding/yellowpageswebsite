/* eslint-disable @next/next/no-img-element -- Drive and Docs previews use short-lived authenticated URLs. */
import Head from 'next/head';
import Link from 'next/link';
import {useEffect, useMemo, useState} from 'react';
import {useRouter} from 'next/router';
import {
    ArrowLeftIcon,
    ArrowTopRightOnSquareIcon,
    DocumentMagnifyingGlassIcon,
    ExclamationTriangleIcon,
    FolderOpenIcon,
    SparklesIcon,
} from '@heroicons/react/24/outline';
import {getAuth, GoogleAuthProvider, reauthenticateWithPopup} from 'firebase/auth';
import {doc, getDoc, getFirestore, serverTimestamp, setDoc} from 'firebase/firestore';
import {getApp} from 'firebase/app';
import {remark} from 'remark';
import html from 'remark-html';
import matter from 'gray-matter';
import ContentNavbar from '../../components/ContentNavbar';
import NoAuth from '../../components/auth/NoAuth';
import ArticleCardPreview from '../../components/ArticleCardPreview';
import ArticlePreview from '../../components/ArticlePreview';
import {useUser} from '../../firebase/useUser';
import {useAuthors} from '../../hooks/useAuthors';
import {getAdmins} from '../../lib/firebase';
import {inspectDriveSource, prepareVisionImages} from '../../lib/manualDriveImport';
import {
    buildImportMediaItems,
    normalizeImportedSourceText,
    stripImportedPublicationHeader,
} from '../../lib/importHandoff';

const DRIVE_TOKEN_STORAGE_KEY = 'yellowpages-drive-readonly-token-v1';
const DRIVE_TOKEN_LIFETIME_MS = 50 * 60 * 1000;
const EMPTY_DRAFT = {
    title: '',
    authors: [],
    authorIds: [],
    date: '',
    blurb: '',
    tags: [],
    imageUrl: '',
    featuredImageId: '',
    size: 'normal',
    markdown: '',
};

const readCachedDriveToken = () => {
    if (typeof window === 'undefined') return null;
    try {
        const cached = JSON.parse(window.sessionStorage.getItem(DRIVE_TOKEN_STORAGE_KEY));
        if (cached?.accessToken && cached?.expiresAt > Date.now()) return cached.accessToken;
        window.sessionStorage.removeItem(DRIVE_TOKEN_STORAGE_KEY);
    } catch {
        window.sessionStorage.removeItem(DRIVE_TOKEN_STORAGE_KEY);
    }
    return null;
};

const cacheDriveToken = (accessToken) => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(DRIVE_TOKEN_STORAGE_KEY, JSON.stringify({
        accessToken,
        expiresAt: Date.now() + DRIVE_TOKEN_LIFETIME_MS,
    }));
};

const clearCachedDriveToken = () => {
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(DRIVE_TOKEN_STORAGE_KEY);
};

const normalizeName = (value = '') => value.trim().toLowerCase().replace(/\s+/g, ' ');

export default function ArticlePreparation({admins}) {
    const router = useRouter();
    const {user} = useUser();
    const adminIdSet = useMemo(() => new Set(Array.isArray(admins) ? admins : []), [admins]);
    const isAdmin = Boolean(user) && adminIdSet.has(user.id);
    const {authors, loading: authorsLoading} = useAuthors({enabled: isAdmin});
    const authorLookup = useMemo(() => new Map(authors.map((author) => [author.id, author])), [authors]);
    const authorNameLookup = useMemo(() => new Map(authors.map((author) => [normalizeName(author.fullName), author])), [authors]);

    const [source, setSource] = useState('');
    const [inspection, setInspection] = useState(null);
    const [inspectionError, setInspectionError] = useState('');
    const [isInspecting, setIsInspecting] = useState(false);
    const [workflowMode, setWorkflowMode] = useState('assisted');
    const [selectedSourceKey, setSelectedSourceKey] = useState('');
    const [analysisResult, setAnalysisResult] = useState(null);
    const [analysisError, setAnalysisError] = useState('');
    const [analysisStatus, setAnalysisStatus] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isCreatingDraft, setIsCreatingDraft] = useState(false);
    const [editorDraft, setEditorDraft] = useState(EMPTY_DRAFT);
    const [draftStarted, setDraftStarted] = useState(false);
    const [unmatchedAuthors, setUnmatchedAuthors] = useState([]);
    const [mediaItems, setMediaItems] = useState([]);
    const [previewHtml, setPreviewHtml] = useState('');
    const publicationMarkdown = useMemo(() => stripImportedPublicationHeader({
        markdown: editorDraft.markdown,
        title: editorDraft.title,
        authors: editorDraft.authors,
    }), [editorDraft.authors, editorDraft.markdown, editorDraft.title]);

    const sourceOptions = useMemo(() => (inspection?.documents || []).flatMap((document) =>
        (document.tabs || []).map((tab, index) => ({
            key: `${document.id}:${tab.id || index}`,
            documentId: document.id,
            documentName: document.name,
            tabId: tab.id,
            tabTitle: tab.title,
            text: tab.text,
            characterCount: tab.characterCount,
        }))
    ), [inspection]);

    useEffect(() => {
        if (!publicationMarkdown) {
            setPreviewHtml('');
            return;
        }
        let cancelled = false;
        remark().use(html, {sanitize: true}).process(matter(publicationMarkdown).content)
            .then((processed) => { if (!cancelled) setPreviewHtml(processed.toString()); })
            .catch(() => { if (!cancelled) setPreviewHtml(''); });
        return () => { cancelled = true; };
    }, [publicationMarkdown]);

    if (!user) return <NoAuth/>;
    if (!isAdmin) return <NoAuth permission={true}/>;

    const authorizeDrive = async () => {
        const firebaseUser = getAuth().currentUser;
        if (!firebaseUser) throw new Error('Please sign in again before accessing Drive.');
        const provider = new GoogleAuthProvider();
        provider.addScope('https://www.googleapis.com/auth/drive.readonly');
        provider.setCustomParameters({login_hint: firebaseUser.email || ''});
        const credentialResult = await reauthenticateWithPopup(firebaseUser, provider);
        const credential = GoogleAuthProvider.credentialFromResult(credentialResult);
        if (!credential?.accessToken) throw new Error('Google did not return a Drive access token.');
        cacheDriveToken(credential.accessToken);
        return credential.accessToken;
    };

    const inspectWithToken = async (accessToken) => inspectDriveSource({source, accessToken});

    const handleInspect = async (event) => {
        event.preventDefault();
        if (draftStarted && !window.confirm('Inspecting another source will replace this prepared draft. Continue?')) return;
        setInspectionError('');
        setInspection(null);
        setAnalysisResult(null);
        setAnalysisError('');
        setDraftStarted(false);
        setEditorDraft(EMPTY_DRAFT);
        setMediaItems([]);
        setIsInspecting(true);
        try {
            let accessToken = readCachedDriveToken() || await authorizeDrive();
            let nextInspection;
            try {
                nextInspection = await inspectWithToken(accessToken);
            } catch (error) {
                if (error?.status !== 401) throw error;
                clearCachedDriveToken();
                accessToken = await authorizeDrive();
                nextInspection = await inspectWithToken(accessToken);
            }
            setInspection(nextInspection);
            const options = nextInspection.documents.flatMap((document) =>
                document.tabs.map((tab, index) => ({key: `${document.id}:${tab.id || index}`, tab}))
            );
            const firstSubstantial = options.find((option) => option.tab.characterCount >= 500) || options[0];
            setSelectedSourceKey(firstSubstantial?.key || '');
            setMediaItems(buildImportMediaItems(nextInspection, null));
        } catch (error) {
            const message = error?.message || 'Unable to inspect this Drive source.';
            setInspectionError(/has not been used|accessNotConfigured|disabled/i.test(message)
                ? `${message} Enable the Google Drive API and Google Docs API, then try again.`
                : message);
        } finally {
            setIsInspecting(false);
        }
    };

    const applyAuthors = (suggestedNames) => {
        const matched = [];
        const unmatched = [];
        for (const name of suggestedNames || []) {
            const author = authorNameLookup.get(normalizeName(name));
            if (author?.id) matched.push(author.id); else if (name?.trim()) unmatched.push(name.trim());
        }
        setUnmatchedAuthors(unmatched);
        return {
            authorIds: Array.from(new Set(matched)),
            authors: Array.from(new Set(matched)).map((id) => authorLookup.get(id)?.fullName).filter(Boolean),
        };
    };

    const applyAnalysis = (payload) => {
        const analysis = payload.analysis;
        const authorFields = applyAuthors(analysis.authors);
        const articleMarkdown = stripImportedPublicationHeader({
            markdown: analysis.articleMarkdown,
            title: analysis.title,
            authors: analysis.authors,
        });
        setEditorDraft((previous) => ({
            ...previous,
            title: analysis.title || '',
            ...authorFields,
            blurb: analysis.blurb || '',
            tags: analysis.suggestedTags || [],
            markdown: articleMarkdown,
        }));
        setMediaItems((existing) => {
            const prepared = buildImportMediaItems(inspection, analysis);
            const existingMap = new Map(existing.map((item) => [item.key, item]));
            return prepared.map((item) => {
                const prior = existingMap.get(item.key);
                if (!prior) return item;
                return {
                    ...item,
                    role: prior.role !== 'unused' ? prior.role : item.role,
                    caption: prior.caption || item.caption,
                    altText: prior.altText || item.altText,
                    credit: prior.credit,
                    rightsStatus: prior.rightsStatus,
                };
            });
        });
        setDraftStarted(true);
    };

    const handleAnalyze = async () => {
        if (draftStarted && !window.confirm('Preparing again will replace the AI-filled fields and article body. Continue?')) return;
        setAnalysisError('');
        setAnalysisResult(null);
        setIsAnalyzing(true);
        try {
            const firebaseUser = getAuth().currentUser;
            if (!firebaseUser) throw new Error('Please sign in again before running AI preparation.');
            let accessToken = readCachedDriveToken();
            if (!accessToken) accessToken = await authorizeDrive();
            setAnalysisStatus('Preparing image previews for responsible visual analysis…');
            const vision = await prepareVisionImages({inspection, accessToken, maximumImages: 6});
            setAnalysisStatus(`Reviewing ${sourceOptions.length} source tab${sourceOptions.length === 1 ? '' : 's'}${vision.images.length ? ` and ${vision.images.length} image${vision.images.length === 1 ? '' : 's'}` : ''}…`);
            const idToken = await firebaseUser.getIdToken();
            const response = await fetch('/api/admin/analyze-article', {
                method: 'POST',
                headers: {Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json'},
                body: JSON.stringify({submission: {...inspection, visionImages: vision.images, visionWarnings: vision.warnings}}),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error || 'AI preparation failed.');
            setAnalysisResult(payload);
            applyAnalysis(payload);
        } catch (error) {
            setAnalysisError(error?.message || 'AI preparation failed.');
        } finally {
            setAnalysisStatus('');
            setIsAnalyzing(false);
        }
    };

    const handleUseSelectedSource = () => {
        const selected = sourceOptions.find((option) => option.key === selectedSourceKey);
        if (!selected) return;
        setAnalysisResult(null);
        setUnmatchedAuthors([]);
        setEditorDraft((previous) => ({...previous, markdown: normalizeImportedSourceText(selected.text)}));
        setDraftStarted(true);
    };

    const selectedMedia = mediaItems.filter((item) => item.role !== 'unused');
    const blockingItems = [
        !editorDraft.title.trim() && 'headline',
        !editorDraft.authorIds.length && 'staff credit',
        !editorDraft.date && 'publication date',
        !editorDraft.blurb.trim() && 'blurb',
        !editorDraft.tags.length && 'site tag',
        editorDraft.markdown.trim().length < 100 && 'article body',
        selectedMedia.some((item) => !item.altText.trim() || ['unreviewed', 'unknown'].includes(item.rightsStatus)) && 'image rights and alt text',
    ].filter(Boolean);
    const analysisWarnings = Array.from(new Set(analysisResult?.analysis?.warnings || []));
    const warningSet = new Set(analysisWarnings.map((warning) => warning.trim().toLowerCase()));
    const editorialNotes = Array.from(new Set(analysisResult?.analysis?.editorialNotes || []))
        .filter((note) => !warningSet.has(note.trim().toLowerCase()));

    const handleContinue = async () => {
        if (!draftStarted || isCreatingDraft) return;
        setIsCreatingDraft(true);
        setAnalysisError('');
        try {
            const selected = sourceOptions.find((option) => option.key === selectedSourceKey);
            const sourceDocumentId = selected?.documentId || analysisResult?.analysis?.selectedDocumentId || inspection?.root?.id || 'source';
            const sourceTabId = selected?.tabId || analysisResult?.analysis?.selectedTabId || 'document';
            const sourceKey = `${sourceDocumentId}:${sourceTabId}`.replaceAll('/', '%2F');
            const draftReference = doc(getFirestore(getApp()), 'articleDrafts', sourceKey);
            const existingDraft = await getDoc(draftReference);
            if (existingDraft.exists()) {
                await router.push(`/upload?draftId=${draftReference.id}`);
                return;
            }
            await setDoc(draftReference, {
                status: 'needs_review',
                title: editorDraft.title || selected?.tabTitle || inspection?.root?.name || 'Untitled imported story',
                authors: editorDraft.authors || [],
                authorIds: editorDraft.authorIds || [],
                date: editorDraft.date || '',
                blurb: editorDraft.blurb || '',
                tags: editorDraft.tags || [],
                imageUrl: '',
                featuredImageId: '',
                size: editorDraft.size || 'normal',
                markdown: publicationMarkdown,
                issueId: null,
                sourceKey,
                mediaItems,
                blockers: blockingItems,
                source: {
                    type: 'google_drive',
                    rootId: inspection?.root?.id || null,
                    rootName: inspection?.root?.name || '',
                    url: inspection?.root?.webViewLink || source,
                    documentId: selected?.documentId || analysisResult?.analysis?.selectedDocumentId || null,
                    documentName: selected?.documentName || '',
                    tabId: selected?.tabId || analysisResult?.analysis?.selectedTabId || null,
                    tabTitle: selected?.tabTitle || '',
                },
                ai: analysisResult ? {
                    model: analysisResult.model || '',
                    readiness: analysisResult.analysis.readiness,
                    confidence: analysisResult.analysis.confidence,
                    selectionReason: analysisResult.analysis.selectionReason,
                    warnings: analysisWarnings,
                    editorialNotes,
                    removedMaterial: analysisResult.analysis.removedMaterial || [],
                } : null,
                unmatchedAuthors,
                createdBy: user.id,
                createdByName: user.name || user.email || '',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            await router.push(`/upload?draftId=${draftReference.id}`);
        } catch (error) {
            setAnalysisError(error?.message || 'Unable to create a newsroom draft.');
            setIsCreatingDraft(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900">
            <Head><title>Import from Drive | The Yellow Pages</title></Head>
            <ContentNavbar/>
            <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
                <Link href="/admin" className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-700">
                    <ArrowLeftIcon className="h-4 w-4"/> Newsroom
                </Link>

                <header className="mt-7 border-b-4 border-slate-900 pb-8">
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-600">Intake</p>
                    <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">Import from Drive</h1>
                </header>

                <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <form onSubmit={handleInspect}>
                        <label htmlFor="drive-source" className="text-sm font-semibold text-slate-900">Drive folder or Google Doc link</label>
                        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                            <input id="drive-source" value={source} onChange={(event) => setSource(event.target.value)} placeholder="https://drive.google.com/drive/folders/…" className="min-w-0 flex-1 rounded-md border border-gray-300 px-4 py-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200" required/>
                            <button type="submit" disabled={isInspecting} className="inline-flex items-center justify-center gap-2 rounded-md bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
                                <FolderOpenIcon className="h-5 w-5"/>{isInspecting ? 'Inspecting…' : inspection ? 'Inspect another source' : 'Inspect source'}
                            </button>
                        </div>
                        {inspectionError && <p role="alert" className="mt-4 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{inspectionError}</p>}
                    </form>
                </section>

                {inspection && <>
                    <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
                            <div className="flex flex-wrap items-start justify-between gap-4">
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Source ready</p>
                                    <h2 className="mt-2 text-2xl font-bold text-emerald-950">{inspection.root.name}</h2>
                                    <p className="mt-2 text-sm text-emerald-800">{inspection.documents.length} document{inspection.documents.length === 1 ? '' : 's'} · {sourceOptions.length} tab{sourceOptions.length === 1 ? '' : 's'} · {mediaItems.length} image{mediaItems.length === 1 ? '' : 's'}</p>
                                </div>
                                <a href={inspection.root.webViewLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-800 underline">Open source <ArrowTopRightOnSquareIcon className="h-4 w-4"/></a>
                            </div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                            <p className="text-sm font-semibold text-slate-900">Preparation mode</p>
                            <div className="mt-3 grid grid-cols-2 gap-2">
                                <button type="button" onClick={() => setWorkflowMode('manual')} className={`rounded-lg border p-3 text-left text-xs ${workflowMode === 'manual' ? 'border-indigo-500 bg-indigo-50 text-indigo-900' : 'border-slate-200 text-slate-600'}`}><span className="block font-semibold">Manual</span><span className="mt-1 block">Choose a tab yourself</span></button>
                                <button type="button" onClick={() => setWorkflowMode('assisted')} className={`rounded-lg border p-3 text-left text-xs ${workflowMode === 'assisted' ? 'border-violet-500 bg-violet-50 text-violet-900' : 'border-slate-200 text-slate-600'}`}><span className="block font-semibold">AI assisted</span><span className="mt-1 block">Prepare, then review</span></button>
                            </div>
                        </div>
                    </section>

                    {(inspection.warnings.length > 0) && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="flex gap-3"><ExclamationTriangleIcon className="h-5 w-5 shrink-0 text-amber-700"/><div><p className="text-sm font-semibold text-amber-950">Source issues need attention</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">{inspection.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div></div></div>}

                    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="flex items-start gap-3"><DocumentMagnifyingGlassIcon className="h-6 w-6 text-indigo-600"/><h2 className="text-xl font-bold">Choose the source</h2></div>
                        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                            <select value={selectedSourceKey} onChange={(event) => setSelectedSourceKey(event.target.value)} className="min-w-0 flex-1 rounded-md border border-gray-300 p-3 text-sm">
                                {sourceOptions.map((option) => <option key={option.key} value={option.key}>{option.documentName} — {option.tabTitle} ({option.characterCount.toLocaleString()} chars)</option>)}
                            </select>
                            {workflowMode === 'manual' ? <button type="button" onClick={handleUseSelectedSource} className="rounded-md bg-slate-800 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-900">Use selected tab</button> : <button type="button" onClick={handleAnalyze} disabled={isAnalyzing || sourceOptions.length === 0} className="inline-flex items-center justify-center gap-2 rounded-md bg-violet-700 px-5 py-3 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-60"><SparklesIcon className="h-5 w-5"/>{isAnalyzing ? analysisStatus || 'Preparing…' : 'Prepare with AI'}</button>}
                        </div>
                        {analysisError && <p role="alert" className="mt-4 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{analysisError}</p>}
                        <details className="mt-5 border-t border-slate-200 pt-4"><summary className="cursor-pointer text-sm font-semibold text-indigo-700">Review all extracted tabs</summary><div className="mt-4 grid gap-4 lg:grid-cols-2">{sourceOptions.map((option) => <article key={option.key} className={`rounded-xl border p-4 ${option.key === selectedSourceKey ? 'border-indigo-300 bg-indigo-50/50' : 'border-slate-200 bg-slate-50'}`}><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{option.documentName} — {option.tabTitle}</h3><span className="text-xs text-slate-500">{option.characterCount.toLocaleString()} chars</span></div><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{option.text.slice(0, 600) || 'Empty tab'}{option.text.length > 600 ? '…' : ''}</p></article>)}</div></details>
                    </section>
                </>}

                {draftStarted && <>
                    {analysisResult && <section className="mt-6 rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-6 shadow-sm">
                        <div className="flex flex-col justify-between gap-4 sm:flex-row">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">Prepared with AI</p>
                                <h2 className="mt-2 text-2xl font-bold capitalize text-violet-950">{analysisResult.analysis.readiness.replaceAll('_', ' ')} <span className="font-medium text-violet-600">· {Math.round(analysisResult.analysis.confidence * 100)}% confidence</span></h2>
                                <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-700">{analysisResult.analysis.selectionReason}</p>
                            </div>
                        </div>
                        {(analysisWarnings.length > 0 || editorialNotes.length > 0) && <div className="mt-5 grid gap-4 lg:grid-cols-2">
                            {analysisWarnings.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                                <div className="flex items-center gap-2"><ExclamationTriangleIcon className="h-5 w-5 text-amber-700"/><h3 className="font-semibold text-amber-950">Verify before handoff</h3></div>
                                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-5 text-amber-900">{analysisWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                            </div>}
                            {editorialNotes.length > 0 && <div className="rounded-xl border border-violet-200 bg-white p-4">
                                <h3 className="font-semibold text-violet-950">Editorial notes</h3>
                                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-5 text-slate-700">{editorialNotes.map((note) => <li key={note}>{note}</li>)}</ul>
                            </div>}
                        </div>}
                    </section>}

                    <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
                        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
                            <div className="flex flex-wrap items-start justify-between gap-4">
                                <div>
                                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-600">Prepared newsroom draft</p>
                                    <h2 className="mt-3 text-3xl font-bold tracking-tight">{editorDraft.title || 'Headline needs review'}</h2>
                                </div>
                                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{publicationMarkdown.length.toLocaleString()} characters</span>
                            </div>
                            <dl className="mt-7 grid gap-4 border-y border-slate-200 py-5 sm:grid-cols-3">
                                <div><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Byline matches</dt><dd className="mt-1 text-sm font-semibold">{editorDraft.authors.length ? editorDraft.authors.join(', ') : 'Needs editor'}</dd></div>
                                <div><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Suggested section</dt><dd className="mt-1 text-sm font-semibold">{editorDraft.tags.length ? editorDraft.tags.join(', ') : 'Needs editor'}</dd></div>
                                <div><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Source media</dt><dd className="mt-1 text-sm font-semibold">{mediaItems.length} found</dd></div>
                            </dl>
                            {unmatchedAuthors.length > 0 && <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Unmatched source byline: {unmatchedAuthors.join(', ')}. Resolve it in the article editor.</p>}
                            <details className="mt-6"><summary className="cursor-pointer text-sm font-bold text-indigo-700">Preview prepared copy</summary><div className="mt-4 max-h-[34rem] overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-5"><ArticlePreview formData={editorDraft} html={previewHtml}/></div></details>
                        </div>
                        <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
                            <div className="rounded-3xl bg-slate-900 p-6 text-white shadow-sm">
                                <h2 className="text-2xl font-bold">Save to the newsroom</h2>
                                <button type="button" onClick={handleContinue} disabled={isCreatingDraft} className="mt-6 w-full rounded-full bg-yellow-300 px-5 py-3 text-sm font-bold text-slate-900 transition hover:bg-yellow-200 disabled:cursor-not-allowed disabled:opacity-60">{isCreatingDraft ? 'Saving…' : 'Save draft'}</button>
                                {blockingItems.length > 0 && <p className="mt-4 text-xs leading-5 text-slate-400">The editor will flag: {blockingItems.join(', ')}.</p>}
                            </div>
                            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><ArticleCardPreview formData={editorDraft}/></div>
                        </aside>
                    </section>
                </>}
            </main>
        </div>
    );
}

export async function getServerSideProps() {
    const admins = await getAdmins();
    return {props: {admins: admins.admins}};
}
