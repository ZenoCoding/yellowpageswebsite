import Head from 'next/head';
import Link from 'next/link';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {addDoc, collection, getDocs, getFirestore, serverTimestamp} from 'firebase/firestore';
import {getApp} from 'firebase/app';
import {
    ArrowLeftIcon,
    ArrowRightIcon,
    CalendarDaysIcon,
    DocumentPlusIcon,
    InboxStackIcon,
    PlusIcon,
} from '@heroicons/react/24/outline';
import ContentNavbar from '../../components/ContentNavbar';
import NoAuth from '../../components/auth/NoAuth';
import {useUser} from '../../firebase/useUser';
import {getAdmins} from '../../lib/firebase';
import {createIssueRecord, ISSUE_STATUSES} from '../../lib/newsroom';
import {compareDraftsForReview, getDraftReviewActions} from '../../lib/articleAutomation';

const STATUS_STYLE = {
    imported: 'bg-sky-100 text-sky-800',
    ai_prepared: 'bg-violet-100 text-violet-800',
    needs_review: 'bg-amber-100 text-amber-900',
    copy_ready: 'bg-indigo-100 text-indigo-800',
    media_ready: 'bg-cyan-100 text-cyan-800',
    ready: 'bg-emerald-100 text-emerald-800',
    published: 'bg-slate-200 text-slate-800',
};

const formatStatus = (value = 'needs_review') => value.replaceAll('_', ' ');
const toMillis = (value) => value?.toMillis?.() || value?.toDate?.()?.getTime?.() || 0;

export default function NewsroomQueue({admins}) {
    const {user} = useUser();
    const adminIds = useMemo(() => new Set(admins || []), [admins]);
    const isAdmin = Boolean(user) && adminIds.has(user.id);
    const [drafts, setDrafts] = useState([]);
    const [issues, setIssues] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showIssueForm, setShowIssueForm] = useState(false);
    const [savingIssue, setSavingIssue] = useState(false);
    const [issueForm, setIssueForm] = useState({name: '', schoolYear: '', volumeNumber: '', issueNumber: '', targetPublicationDate: ''});

    const loadQueue = useCallback(async () => {
        if (!isAdmin) return;
        setLoading(true);
        setError('');
        try {
            const db = getFirestore(getApp());
            const [draftSnapshot, issueSnapshot] = await Promise.all([
                getDocs(collection(db, 'articleDrafts')),
                getDocs(collection(db, 'issues')),
            ]);
            setDrafts(draftSnapshot.docs.map((item) => ({id: item.id, ...item.data()})).sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt)));
            setIssues(issueSnapshot.docs.map((item) => ({id: item.id, ...item.data()})).sort((a, b) => String(b.targetPublicationDate || '').localeCompare(String(a.targetPublicationDate || ''))));
        } catch (loadError) {
            setError(loadError?.message || 'Unable to load the newsroom queue.');
        } finally {
            setLoading(false);
        }
    }, [isAdmin]);

    useEffect(() => { loadQueue(); }, [loadQueue]);

    if (!user) return <NoAuth/>;
    if (!isAdmin) return <NoAuth permission={true}/>;

    const createIssue = async (event) => {
        event.preventDefault();
        setSavingIssue(true);
        setError('');
        try {
            const slug = `${issueForm.name}-${issueForm.schoolYear}`.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            if (issues.some((issue) => issue.slug === slug)) throw new Error('An issue with this name and school year already exists.');
            const record = createIssueRecord({...issueForm, slug, status: ISSUE_STATUSES.PLANNING});
            await addDoc(collection(getFirestore(getApp()), 'issues'), {
                ...record,
                createdBy: user.id,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            setIssueForm({name: '', schoolYear: '', volumeNumber: '', issueNumber: '', targetPublicationDate: ''});
            setShowIssueForm(false);
            await loadQueue();
        } catch (saveError) {
            setError(saveError?.message || 'Unable to create the issue.');
        } finally {
            setSavingIssue(false);
        }
    };

    const openDrafts = drafts.filter((draft) => !['published', 'archived', 'rejected', 'duplicate', 'withdrawn'].includes(draft.status)).sort(compareDraftsForReview);
    const blockedDrafts = openDrafts.filter((draft) => Array.isArray(draft.blockers) && draft.blockers.length > 0);

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900">
            <Head><title>Newsroom Queue | The Yellow Pages</title></Head>
            <ContentNavbar/>
            <main className="mx-auto max-w-7xl px-5 py-10 sm:px-8 lg:px-10">
                <Link href="/admin" className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-slate-900"><ArrowLeftIcon className="h-4 w-4"/>Admin desk</Link>
                <header className="mt-8 flex flex-col gap-7 border-b border-slate-200 pb-9 lg:flex-row lg:items-end lg:justify-between">
                    <div className="max-w-3xl">
                        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-6xl">Newsroom queue</h1>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <Link href="/admin/import" className="inline-flex items-center gap-2 rounded-full bg-yellow-300 px-5 py-3 text-sm font-bold hover:bg-yellow-200"><InboxStackIcon className="h-5 w-5"/>Import from Drive</Link>
                        <Link href="/upload" className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800"><DocumentPlusIcon className="h-5 w-5"/>Blank article</Link>
                    </div>
                </header>

                <section className="mt-8 grid gap-4 sm:grid-cols-3">
                    {[['Open drafts', openDrafts.length], ['Blocked', blockedDrafts.length], ['Issues', issues.length]].map(([label, value]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{label}</p><p className="mt-2 text-4xl font-bold">{value}</p></div>)}
                </section>

                {error && <p role="alert" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</p>}

                <section className="mt-10 grid gap-8 xl:grid-cols-[minmax(0,1fr)_23rem]">
                    <div>
                        <div className="flex items-end justify-between gap-4"><h2 className="text-3xl font-bold">Stories</h2><button onClick={loadQueue} className="text-sm font-bold text-indigo-700">Refresh</button></div>
                        <div className="mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                            {loading ? <p className="p-8 text-sm text-slate-500">Loading…</p> : openDrafts.length === 0 ? <div className="p-10 text-center"><h3 className="text-xl font-bold">No open drafts</h3></div> : openDrafts.map((draft) => {
                                const issue = issues.find((item) => item.id === draft.issueId);
                                const blockers = Array.isArray(draft.blockers) ? draft.blockers : [];
                                return <Link key={draft.id} href={`/upload?draftId=${draft.id}`} className="group grid gap-4 border-b border-slate-200 p-5 last:border-0 hover:bg-yellow-50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                                    <div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[0.68rem] font-bold uppercase tracking-wide ${STATUS_STYLE[draft.status] || STATUS_STYLE.needs_review}`}>{formatStatus(draft.status)}</span>{issue && <span className="text-xs font-semibold text-slate-500">{issue.name}</span>}</div><h3 className="mt-3 text-xl font-bold group-hover:underline">{draft.title || 'Untitled story'}</h3><p className="mt-1 text-sm text-slate-500">{draft.source?.rootName || draft.source?.sourceName || 'Manual draft'}{blockers.length ? ` · ${blockers.length} blocker${blockers.length === 1 ? '' : 's'}` : ' · Ready for final review'}</p>{getDraftReviewActions(draft).length > 0 && <ul className="mt-3 space-y-1 text-sm text-amber-900">{getDraftReviewActions(draft).slice(0, 2).map((action) => <li key={action}>• {action}</li>)}</ul>}</div>
                                    <ArrowRightIcon className="h-5 w-5 text-slate-400 transition group-hover:translate-x-1 group-hover:text-slate-900"/>
                                </Link>;
                            })}
                        </div>
                    </div>

                    <aside>
                        <div className="flex items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Editions</p><h2 className="mt-2 text-2xl font-bold">Issues</h2></div><div className="flex items-center gap-2"><Link href="/admin/issues" className="text-xs font-bold text-indigo-700 hover:underline">Manage</Link><button onClick={() => setShowIssueForm((value) => !value)} className="rounded-full bg-slate-900 p-2 text-white"><PlusIcon className="h-4 w-4"/></button></div></div>
                        {showIssueForm && <form onSubmit={createIssue} className="mt-4 space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><label className="block text-xs font-bold text-slate-700">Issue name<input required value={issueForm.name} onChange={(event) => setIssueForm({...issueForm, name: event.target.value})} placeholder="Winter 2026" className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"/></label><label className="block text-xs font-bold text-slate-700">School year<input required value={issueForm.schoolYear} onChange={(event) => setIssueForm({...issueForm, schoolYear: event.target.value})} placeholder="2026–27" className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"/></label><div className="grid grid-cols-2 gap-3"><label className="text-xs font-bold text-slate-700">Volume<input type="number" min="1" value={issueForm.volumeNumber} onChange={(event) => setIssueForm({...issueForm, volumeNumber: event.target.value})} className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"/></label><label className="text-xs font-bold text-slate-700">Issue no.<input type="number" min="1" value={issueForm.issueNumber} onChange={(event) => setIssueForm({...issueForm, issueNumber: event.target.value})} className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"/></label></div><label className="block text-xs font-bold text-slate-700">Issue publication date<input required type="date" value={issueForm.targetPublicationDate} onChange={(event) => setIssueForm({...issueForm, targetPublicationDate: event.target.value})} className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"/></label><p className="text-xs leading-5 text-slate-500">This date becomes the default for every article assigned to the issue. Volume and issue numbers remain optional.</p><button disabled={savingIssue} className="w-full rounded-full bg-yellow-300 px-4 py-2.5 text-sm font-bold disabled:opacity-60">{savingIssue ? 'Creating…' : 'Create issue'}</button></form>}
                        <div className="mt-4 space-y-3">{issues.length === 0 && !loading ? <p className="rounded-2xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">No issues yet. Create one when stories share a deadline or edition.</p> : issues.map((issue) => <div key={issue.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start gap-3"><CalendarDaysIcon className="mt-0.5 h-5 w-5 text-amber-600"/><div><h3 className="font-bold">{issue.name}</h3><p className="mt-1 text-xs text-slate-500">{issue.schoolYear}{issue.volumeNumber ? ` · Vol. ${issue.volumeNumber}` : ''}{issue.issueNumber ? `, No. ${issue.issueNumber}` : ''}</p><p className="mt-2 text-xs font-semibold capitalize text-slate-700">{issue.status}</p></div></div></div>)}</div>
                    </aside>
                </section>
            </main>
        </div>
    );
}

export async function getServerSideProps() {
    const admins = await getAdmins();
    return {props: {admins: admins.admins}};
}
