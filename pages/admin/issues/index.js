import Head from 'next/head';
import Link from 'next/link';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {addDoc, collection, getDocs, getFirestore, serverTimestamp} from 'firebase/firestore';
import {getApp} from 'firebase/app';
import {ArrowLeftIcon, ArrowRightIcon, CalendarDaysIcon, PlusIcon} from '@heroicons/react/24/outline';
import ContentNavbar from '../../../components/ContentNavbar';
import NoAuth from '../../../components/auth/NoAuth';
import IssueForm, {EMPTY_ISSUE_FORM} from '../../../components/issues/IssueForm';
import {useUser} from '../../../firebase/useUser';
import {getAdmins} from '../../../lib/firebase';

const STATUS_STYLE = {
    planning: 'bg-slate-100 text-slate-700', active: 'bg-emerald-100 text-emerald-800',
    closed: 'bg-amber-100 text-amber-900', published: 'bg-indigo-100 text-indigo-800', archived: 'bg-slate-200 text-slate-600',
};
const toMillis = (value) => value?.toMillis?.() || value?.toDate?.()?.getTime?.() || 0;
const slugify = (value) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const positiveInteger = (value) => value ? Number(value) : null;

export default function IssuesIndex({admins}) {
    const {user} = useUser();
    const adminIds = useMemo(() => new Set(admins || []), [admins]);
    const isAdmin = Boolean(user) && adminIds.has(user.id);
    const [issues, setIssues] = useState([]);
    const [drafts, setDrafts] = useState([]);
    const [articles, setArticles] = useState([]);
    const [form, setForm] = useState(EMPTY_ISSUE_FORM);
    const [showForm, setShowForm] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        if (!isAdmin) return;
        setLoading(true); setError('');
        try {
            const db = getFirestore(getApp());
            const [issueSnap, draftSnap, articleSnap] = await Promise.all([
                getDocs(collection(db, 'issues')), getDocs(collection(db, 'articleDrafts')), getDocs(collection(db, 'articles')),
            ]);
            setIssues(issueSnap.docs.map((item) => ({id: item.id, ...item.data()})).sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt)));
            setDrafts(draftSnap.docs.map((item) => ({id: item.id, ...item.data()})));
            setArticles(articleSnap.docs.map((item) => ({id: item.id, ...item.data()})));
        } catch (loadError) { setError(loadError?.message || 'Unable to load issues.'); } finally { setLoading(false); }
    }, [isAdmin]);

    useEffect(() => { load(); }, [load]);
    if (!user) return <NoAuth/>;
    if (!isAdmin) return <NoAuth permission={true}/>;

    const createIssue = async (event) => {
        event.preventDefault(); setSaving(true); setError('');
        try {
            const slug = slugify(`${form.name}-${form.schoolYear}`);
            if (issues.some((issue) => issue.slug === slug)) throw new Error('An issue with this name and school year already exists.');
            await addDoc(collection(getFirestore(getApp()), 'issues'), {
                name: form.name.trim(), slug, schoolYear: form.schoolYear.trim(),
                volumeNumber: positiveInteger(form.volumeNumber), issueNumber: positiveInteger(form.issueNumber),
                targetPublicationDate: form.targetPublicationDate || null, theme: form.theme.trim() || null,
                editorNote: form.editorNote.trim() || null, internalNote: form.internalNote.trim() || null, status: 'planning', publishedAt: null,
                createdBy: user.id, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
            });
            setForm(EMPTY_ISSUE_FORM); setShowForm(false); await load();
        } catch (saveError) { setError(saveError?.message || 'Unable to create the issue.'); } finally { setSaving(false); }
    };

    const counts = (issueId) => ({drafts: drafts.filter((item) => item.issueId === issueId).length, articles: articles.filter((item) => item.issueId === issueId).length});
    const visible = issues.filter((issue) => issue.status !== 'archived');
    const archived = issues.filter((issue) => issue.status === 'archived');

    return <div className="min-h-screen bg-slate-50 text-slate-900">
        <Head><title>Issues | The Yellow Pages</title></Head><ContentNavbar/>
        <main className="mx-auto max-w-7xl px-5 py-10 sm:px-8 lg:px-10">
            <Link href="/admin" className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-slate-900"><ArrowLeftIcon className="h-4 w-4"/>Admin desk</Link>
            <header className="mt-8 flex flex-col gap-7 border-b border-slate-200 pb-9 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-3xl"><h1 className="text-4xl font-bold tracking-tight sm:text-6xl">Issues</h1></div>
                <button type="button" onClick={() => setShowForm((value) => !value)} className="inline-flex w-fit items-center gap-2 rounded-full border-2 border-slate-900 bg-yellow-300 px-5 py-3 text-sm font-bold text-slate-900 shadow-sm transition hover:-translate-y-0.5 hover:bg-yellow-200 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-500"><PlusIcon className="h-5 w-5"/>{showForm ? 'Close form' : 'Create issue'}</button>
            </header>
            {error && <p role="alert" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</p>}
            {showForm && <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8"><h2 className="mb-6 text-2xl font-bold">New issue</h2><IssueForm value={form} onChange={setForm} onSubmit={createIssue} saving={saving} submitLabel="Create issue"/></section>}
            <section className="mt-10"><div className="flex items-end justify-between"><h2 className="text-3xl font-bold">All issues</h2><button onClick={load} className="text-sm font-bold text-indigo-700">Refresh</button></div>
                <div className="mt-5 grid gap-4 lg:grid-cols-2">{loading ? <p className="text-sm text-slate-500">Loading issues…</p> : visible.length === 0 ? <div className="rounded-3xl border border-dashed border-slate-300 p-10 text-center lg:col-span-2"><CalendarDaysIcon className="mx-auto h-8 w-8 text-slate-400"/><h3 className="mt-4 text-xl font-bold">No active issues yet</h3><p className="mt-2 text-sm text-slate-500">Create the next edition, then assign newsroom drafts to it.</p></div> : visible.map((issue) => { const tally = counts(issue.id); return <Link key={issue.id} href={`/admin/issues/${issue.id}`} className="group rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg"><div className="flex items-start justify-between gap-4"><div><span className={`rounded-full px-2.5 py-1 text-[0.68rem] font-bold uppercase tracking-wide ${STATUS_STYLE[issue.status] || STATUS_STYLE.planning}`}>{issue.status || 'planning'}</span><h3 className="mt-4 text-2xl font-bold group-hover:underline">{issue.name}</h3><p className="mt-1 text-sm text-slate-500">{issue.schoolYear}{issue.volumeNumber ? ` · Vol. ${issue.volumeNumber}` : ''}{issue.issueNumber ? `, No. ${issue.issueNumber}` : ''}</p></div><ArrowRightIcon className="h-5 w-5 text-slate-400 transition group-hover:translate-x-1"/></div>{issue.theme && <p className="mt-5 text-sm leading-6 text-slate-600">{issue.theme}</p>}<div className="mt-5 flex gap-5 border-t border-slate-100 pt-4 text-xs font-bold uppercase tracking-wide text-slate-500"><span>{tally.drafts} draft{tally.drafts === 1 ? '' : 's'}</span><span>{tally.articles} published</span>{issue.targetPublicationDate && <span className="ml-auto normal-case tracking-normal">Target {issue.targetPublicationDate}</span>}</div></Link>; })}</div>
            </section>
            {archived.length > 0 && <details className="mt-10 rounded-2xl border border-slate-200 bg-white p-5"><summary className="cursor-pointer text-sm font-bold">Archived issues ({archived.length})</summary><div className="mt-4 divide-y divide-slate-100">{archived.map((issue) => <Link key={issue.id} href={`/admin/issues/${issue.id}`} className="flex items-center justify-between gap-4 py-3 text-sm hover:underline"><span>{issue.name} <span className="text-slate-500">· {issue.schoolYear}</span></span><ArrowRightIcon className="h-4 w-4"/></Link>)}</div></details>}
        </main>
    </div>;
}

export async function getServerSideProps() { const admins = await getAdmins(); return {props: {admins: admins.admins}}; }
