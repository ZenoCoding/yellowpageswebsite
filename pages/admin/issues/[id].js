import Head from 'next/head';
import Link from 'next/link';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {collection, doc, getDoc, getDocs, getFirestore, serverTimestamp, updateDoc} from 'firebase/firestore';
import {getApp} from 'firebase/app';
import {getAuth} from 'firebase/auth';
import {ArchiveBoxIcon, ArrowLeftIcon, DocumentTextIcon, RocketLaunchIcon} from '@heroicons/react/24/outline';
import ContentNavbar from '../../../components/ContentNavbar';
import NoAuth from '../../../components/auth/NoAuth';
import IssueForm, {EMPTY_ISSUE_FORM} from '../../../components/issues/IssueForm';
import {useUser} from '../../../firebase/useUser';
import {getAdmins} from '../../../lib/firebase';
import {useAuthors} from '../../../hooks/useAuthors';
import IssueBatchImport, {getGoogleDriveAccessToken} from '../../../components/issues/IssueBatchImport';
import {compareDraftsForReview, getDraftReviewActions, getDraftReviewContext} from '../../../lib/articleAutomation';

const fromIssue = (issue) => ({...EMPTY_ISSUE_FORM, name: issue.name || '', schoolYear: issue.schoolYear || '', volumeNumber: issue.volumeNumber || '', issueNumber: issue.issueNumber || '', targetPublicationDate: issue.targetPublicationDate || '', theme: issue.theme || '', editorNote: issue.editorNote || '', internalNote: issue.internalNote || '', status: issue.status || 'planning'});
const positiveInteger = (value) => value ? Number(value) : null;

export default function IssueDetail({admins, issueId}) {
    const {user} = useUser();
    const adminIds = useMemo(() => new Set(admins || []), [admins]);
    const isAdmin = Boolean(user) && adminIds.has(user.id);
    const {authors, loading: authorsLoading} = useAuthors({enabled: isAdmin});
    const [issue, setIssue] = useState(null); const [form, setForm] = useState(EMPTY_ISSUE_FORM);
    const [drafts, setDrafts] = useState([]); const [articles, setArticles] = useState([]); const [allArticles, setAllArticles] = useState([]);
    const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
    const [publishing, setPublishing] = useState(false);

    const load = useCallback(async () => {
        if (!isAdmin) return; setLoading(true); setError('');
        try { const db = getFirestore(getApp()); const [issueSnap, draftSnap, articleSnap] = await Promise.all([getDoc(doc(db, 'issues', issueId)), getDocs(collection(db, 'articleDrafts')), getDocs(collection(db, 'articles'))]);
            if (!issueSnap.exists()) throw new Error('This issue could not be found.');
            const data = {id: issueSnap.id, ...issueSnap.data()}; setIssue(data); setForm(fromIssue(data));
            setDrafts(draftSnap.docs.map((item) => ({id: item.id, ...item.data()})).filter((item) => item.issueId === issueId));
            const loadedArticles = articleSnap.docs.map((item) => ({id: item.id, ...item.data()})); setAllArticles(loadedArticles); setArticles(loadedArticles.filter((item) => item.issueId === issueId));
        } catch (loadError) { setError(loadError?.message || 'Unable to load this issue.'); } finally { setLoading(false); }
    }, [isAdmin, issueId]);
    useEffect(() => { load(); }, [load]);
    if (!user) return <NoAuth/>; if (!isAdmin) return <NoAuth permission={true}/>;

    const save = async (event) => { event.preventDefault(); setSaving(true); setError(''); setNotice('');
        try { const becomingPublished = form.status === 'published' && issue?.status !== 'published'; await updateDoc(doc(getFirestore(getApp()), 'issues', issueId), {name: form.name.trim(), schoolYear: form.schoolYear.trim(), volumeNumber: positiveInteger(form.volumeNumber), issueNumber: positiveInteger(form.issueNumber), targetPublicationDate: form.targetPublicationDate || null, theme: form.theme.trim() || null, editorNote: form.editorNote.trim() || null, internalNote: form.internalNote.trim() || null, status: form.status, publishedAt: becomingPublished ? serverTimestamp() : (issue?.publishedAt || null), updatedBy: user.id, updatedAt: serverTimestamp()}); setNotice('Issue saved.'); await load(); } catch (saveError) { setError(saveError?.message || 'Unable to save this issue.'); } finally { setSaving(false); }
    };
    const archive = async () => { if (!window.confirm('Archive this issue? Its stories will remain intact and the issue can still be opened from the archive.')) return; setSaving(true); try { await updateDoc(doc(getFirestore(getApp()), 'issues', issueId), {status: 'archived', archivedAt: serverTimestamp(), archivedBy: user.id, updatedAt: serverTimestamp()}); await load(); setNotice('Issue archived.'); } catch (saveError) { setError(saveError?.message || 'Unable to archive this issue.'); } finally { setSaving(false); } };
    const readyDrafts = drafts.filter((draft) => draft.status === 'ready');
    const reviewDrafts = drafts.filter((draft) => !['ready', 'published', 'duplicate', 'rejected', 'archived'].includes(draft.status));
    const unpublishedDrafts = drafts.filter((draft) => !['published', 'duplicate', 'rejected', 'archived'].includes(draft.status));
    const orderedDrafts = [...drafts].sort(compareDraftsForReview);
    const publishIssue = async () => {
        if (!readyDrafts.length) return;
        if (!window.confirm(`Publish ${readyDrafts.length} ready stor${readyDrafts.length === 1 ? 'y' : 'ies'}${reviewDrafts.length ? ` and leave ${reviewDrafts.length} exception${reviewDrafts.length === 1 ? '' : 's'} in review` : ''}?`)) return;
        setPublishing(true); setError(''); setNotice('');
        try {
            const firebaseUser = getAuth().currentUser;
            if (!firebaseUser) throw new Error('Your sign-in expired. Sign in and try again.');
            const driveAccessToken = await getGoogleDriveAccessToken();
            const response = await fetch('/api/admin/publish-issue', {
                method: 'POST',
                headers: {Authorization: `Bearer ${await firebaseUser.getIdToken()}`, 'Content-Type': 'application/json'},
                body: JSON.stringify({issueId, driveAccessToken}),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) throw new Error(payload?.error || 'Issue publication failed.');
            setNotice(`Published ${payload.published?.length || 0} stories.${payload.duplicates?.length ? ` ${payload.duplicates.length} already-live stories were safely skipped.` : ''}${payload.exceptions?.length ? ` ${payload.exceptions.length} exceptions remain in review.` : ' The issue is now fully live.'}${payload.mediaFailures?.length ? ` ${payload.mediaFailures.length} images could not be imported and can be retried with Import missing images.` : ''}`);
            await load();
        } catch (publishError) { setError(publishError?.message || 'Issue publication failed.'); }
        finally { setPublishing(false); }
    };
    const recheckAutomation = async () => {
        setPublishing(true); setError(''); setNotice('');
        try {
            const firebaseUser = getAuth().currentUser;
            if (!firebaseUser) throw new Error('Your sign-in expired. Sign in and try again.');
            const response = await fetch('/api/admin/publish-issue', {method: 'POST', headers: {Authorization: `Bearer ${await firebaseUser.getIdToken()}`, 'Content-Type': 'application/json'}, body: JSON.stringify({issueId, action: 'recheck'})});
            const payload = await response.json().catch(() => null);
            if (!response.ok) throw new Error(payload?.error || 'Automation check failed.');
            setNotice(`${payload.ready || 0} stories are ready; ${payload.needsReview || 0} need attention.`); await load();
        } catch (recheckError) { setError(recheckError?.message || 'Automation check failed.'); }
        finally { setPublishing(false); }
    };
    const importMissingImages = async () => {
        setPublishing(true); setError(''); setNotice('');
        try {
            const firebaseUser = getAuth().currentUser;
            if (!firebaseUser) throw new Error('Your sign-in expired. Sign in and try again.');
            const driveAccessToken = await getGoogleDriveAccessToken();
            const response = await fetch('/api/admin/publish-issue', {method: 'POST', headers: {Authorization: `Bearer ${await firebaseUser.getIdToken()}`, 'Content-Type': 'application/json'}, body: JSON.stringify({issueId, action: 'backfill_images', driveAccessToken})});
            const payload = await response.json().catch(() => null);
            if (!response.ok) throw new Error(payload?.error || 'Image import failed.');
            setNotice(`Imported ${payload.imported || 0} article images.${payload.failed?.length ? ` ${payload.failed.length} failed and remain available for retry.` : ''}`); await load();
        } catch (imageError) { setError(imageError?.message || 'Image import failed.'); }
        finally { setPublishing(false); }
    };

    return <div className="min-h-screen bg-slate-50 text-slate-900"><Head><title>{issue?.name || 'Issue'} | The Yellow Pages</title></Head><ContentNavbar/><main className="mx-auto max-w-7xl px-5 py-10 sm:px-8 lg:px-10">
        <Link href="/admin/issues" className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-slate-900"><ArrowLeftIcon className="h-4 w-4"/>All issues</Link>
        {loading ? <p className="mt-10 text-sm text-slate-500">Loading issue…</p> : error && !issue ? <p role="alert" className="mt-8 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</p> : <>
            <header className="mt-8 flex flex-col gap-6 border-b border-slate-200 pb-9 lg:flex-row lg:items-end lg:justify-between"><div><h1 className="text-4xl font-bold tracking-tight sm:text-6xl">{issue?.name}</h1><p className="mt-3 text-lg text-slate-600">{issue?.schoolYear}{issue?.volumeNumber ? ` · Volume ${issue.volumeNumber}` : ''}{issue?.issueNumber ? `, Issue ${issue.issueNumber}` : ''}</p></div><div className="flex gap-3"><span className="rounded-full bg-white px-4 py-2 text-sm font-bold capitalize ring-1 ring-slate-200">{issue?.status}</span>{issue?.status !== 'archived' && <button onClick={archive} disabled={saving} className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-bold hover:border-rose-300 hover:text-rose-700"><ArchiveBoxIcon className="h-4 w-4"/>Archive</button>}</div></header>
            {error && <p role="alert" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</p>}{notice && <p role="status" className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</p>}
            {reviewDrafts.length > 0 && <section className="mt-8 rounded-2xl border border-amber-300 bg-amber-50 p-6 sm:p-8">
                <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Needs attention</p><h2 className="mt-2 text-2xl font-bold">Fix these before the whole issue is ready</h2></div><span className="rounded-full bg-amber-200 px-3 py-1 text-xs font-bold text-amber-950">{reviewDrafts.length} {reviewDrafts.length === 1 ? 'story' : 'stories'}</span></div>
                <div className="mt-5 grid gap-3 lg:grid-cols-2">{[...reviewDrafts].sort(compareDraftsForReview).map((draft) => {
                    const actions = getDraftReviewActions(draft); const context = getDraftReviewContext(draft);
                    return <Link key={`review-${draft.id}`} href={`/upload?draftId=${draft.id}`} className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm transition hover:border-amber-400 hover:shadow-md"><div className="flex items-start justify-between gap-3"><h3 className="font-bold">{draft.title || 'Untitled draft'}</h3><span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-amber-700">Open draft →</span></div><ul className="mt-3 space-y-1.5 text-sm text-slate-700">{(actions.length ? actions : ['Open the draft and confirm its required publication fields.']).map((action) => <li key={action} className="flex gap-2"><span className="font-bold text-amber-600">•</span><span>{action}</span></li>)}</ul>{context.length > 0 && <p className="mt-3 border-t border-amber-100 pt-3 text-xs leading-5 text-slate-500">Why it stopped: {context.join(' ')}</p>}</Link>;
                })}</div>
            </section>}
            <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]"><div className="space-y-8"><IssueBatchImport issue={issue} issueId={issueId} authors={authors} authorsLoading={authorsLoading} existingArticles={allArticles} onImportComplete={load}/><section className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8"><h2 className="text-2xl font-bold">Issue details</h2><div className="mt-7"><IssueForm value={form} onChange={setForm} onSubmit={save} saving={saving} showStatus/></div></section></div>
                <aside className="space-y-5">
                    <div className="grid grid-cols-3 gap-3">{[['Ready', readyDrafts.length], ['Review', reviewDrafts.length], ['Published', articles.length]].map(([label, count]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold">{count}</p></div>)}</div>
                    <div className="rounded-2xl border border-slate-900 bg-slate-900 p-5 text-white shadow-sm">
                        <RocketLaunchIcon className="h-6 w-6 text-amber-300"/>
                        <h2 className="mt-4 text-lg font-bold">Publish this issue</h2>
                        {reviewDrafts.length > 0 ? <p className="mt-2 text-sm leading-6 text-slate-300">{reviewDrafts.length} exception{reviewDrafts.length === 1 ? '' : 's'} will remain in review; ready stories can publish separately.</p> : unpublishedDrafts.length ? <p className="mt-2 text-sm leading-6 text-slate-300">All {readyDrafts.length} prepared stories passed the automated checks.</p> : <p className="mt-2 text-sm leading-6 text-slate-300">All prepared stories in this issue are published.</p>}
                        <button type="button" onClick={publishIssue} disabled={publishing || !readyDrafts.length} className="mt-5 w-full rounded-lg bg-amber-300 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">{publishing ? 'Publishing issue…' : `Publish ${readyDrafts.length || ''} ready ${readyDrafts.length === 1 ? 'story' : 'stories'}`}</button>
                        <button type="button" onClick={recheckAutomation} disabled={publishing || !unpublishedDrafts.length} className="mt-2 w-full rounded-lg border border-slate-600 px-4 py-2 text-xs font-bold text-slate-200 hover:border-slate-400 disabled:opacity-40">Recheck automation</button>
                        <button type="button" onClick={importMissingImages} disabled={publishing || !articles.length} className="mt-2 w-full rounded-lg border border-slate-600 px-4 py-2 text-xs font-bold text-slate-200 hover:border-slate-400 disabled:opacity-40">Import missing and inline images</button>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold">Stories in this issue</h2><p className="mt-1 text-xs text-slate-500">Needs-review stories stay at the top.</p><div className="mt-4 divide-y divide-slate-100">{drafts.length + articles.length === 0 ? <p className="text-sm leading-6 text-slate-500">Import this issue to prepare its stories.</p> : <>{orderedDrafts.slice(0, 12).map((draft) => <Link key={`draft-${draft.id}`} href={`/upload?draftId=${draft.id}`} className="block py-3 text-sm hover:bg-amber-50"><span className="flex items-center gap-3 font-semibold"><DocumentTextIcon className={`h-4 w-4 ${draft.status === 'ready' ? 'text-emerald-600' : draft.status === 'published' ? 'text-indigo-600' : 'text-amber-600'}`}/><span className="min-w-0 flex-1 truncate">{draft.title || 'Untitled draft'}</span><span className="text-[10px] uppercase tracking-wide text-slate-400">{draft.status?.replaceAll('_', ' ')}</span></span>{getDraftReviewActions(draft)[0] && <span className="mt-1 block pl-7 text-xs leading-5 text-amber-800">{getDraftReviewActions(draft)[0]}</span>}</Link>)}</>}</div></div>
                </aside>
            </div>
        </>}
    </main></div>;
}

export async function getServerSideProps({params}) { const admins = await getAdmins(); return {props: {admins: admins.admins, issueId: params.id}}; }
