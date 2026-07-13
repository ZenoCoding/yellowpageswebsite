import Head from 'next/head';
import Link from 'next/link';
import {getApp} from 'firebase/app';
import {collection, getDocs, getFirestore} from 'firebase/firestore';
import Navbar from '../../components/Navbar.js';

const dateFromValue = (value) => {
    if (!value) return null;
    if (typeof value === 'string') {
        const result = new Date(value);
        return Number.isNaN(result.getTime()) ? null : result;
    }
    if (typeof value?.toDate === 'function') return value.toDate();
    if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000);
    return null;
};

const serializeDate = (value) => dateFromValue(value)?.toISOString() || null;

const formatDate = (value) => {
    const date = dateFromValue(value);
    return date
        ? new Intl.DateTimeFormat('en-US', {month: 'long', day: 'numeric', year: 'numeric'}).format(date)
        : null;
};

const issueNumber = (issue) => {
    const parts = [];
    if (issue.volumeNumber) parts.push(`Vol. ${issue.volumeNumber}`);
    if (issue.issueNumber) parts.push(`No. ${issue.issueNumber}`);
    return parts.join(' · ');
};

export default function IssueArchive({issues}) {
    return (
        <div className="min-h-screen bg-white text-slate-900">
            <Head>
                <title>Issues | The Yellow Pages</title>
                <meta
                    name="description"
                    content="Browse published editions of The Yellow Pages."
                />
            </Head>
            <Navbar/>

            <main className="mx-auto max-w-7xl px-4 pb-20 pt-10 sm:px-6 lg:px-8 lg:pt-14">
                <header className="border-y border-slate-900 py-7 sm:py-9">
                    <p className="text-xs font-semibold uppercase tracking-[0.35em] text-yellow-700">
                        The archive
                    </p>
                    <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-end">
                        <h1 className="text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl">
                            Issues
                        </h1>
                    </div>
                </header>

                {issues.length > 0 ? (
                    <div className="mt-10 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
                        {issues.map((issue) => {
                            const numbering = issueNumber(issue);
                            const published = formatDate(issue.publishedAt || issue.targetPublicationDate);
                            return (
                                <article key={issue.id} className="group border-t-4 border-slate-900 pt-5">
                                    <Link href={`/issues/${encodeURIComponent(issue.slug || issue.id)}`} className="block">
                                        <div className="flex min-h-56 flex-col justify-between bg-yellow-300 p-6 transition-colors duration-200 group-hover:bg-yellow-200 sm:min-h-64">
                                            <div>
                                                <p className="text-xs font-bold uppercase tracking-[0.3em] text-slate-700">
                                                    {issue.schoolYear || 'The Yellow Pages'}
                                                </p>
                                                <h2 className="mt-5 text-3xl font-black leading-tight tracking-tight sm:text-4xl">
                                                    {issue.name}
                                                </h2>
                                                {issue.theme && (
                                                    <p className="mt-3 text-base font-medium leading-snug text-slate-700">
                                                        {issue.theme}
                                                    </p>
                                                )}
                                            </div>
                                            <div className="mt-8 border-t border-slate-900/30 pt-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-700">
                                                {numbering || published || 'Published edition'}
                                            </div>
                                        </div>
                                    </Link>
                                    <div className="mt-4 flex items-center justify-between gap-4">
                                        <p className="text-sm text-slate-500">
                                            {published || issue.schoolYear || 'Archive edition'}
                                        </p>
                                        <Link
                                            href={`/issues/${encodeURIComponent(issue.slug || issue.id)}`}
                                            className="text-xs font-bold uppercase tracking-[0.2em] text-slate-800 hover:text-yellow-700"
                                        >
                                            Read issue <span aria-hidden="true">→</span>
                                        </Link>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                ) : (
                    <section className="mt-10 border border-slate-200 bg-slate-50 px-6 py-16 text-center">
                        <h2 className="text-2xl font-bold">No published issues yet.</h2>
                        <Link href="/" className="mt-6 inline-block text-sm font-bold text-yellow-700 hover:text-yellow-800">
                            Return to the front page
                        </Link>
                    </section>
                )}
            </main>
        </div>
    );
}

export async function getServerSideProps() {
    const db = getFirestore(getApp());
    const snapshot = await getDocs(collection(db, 'issues'));
    const issues = snapshot.docs
        .map((document) => {
            const data = document.data() || {};
            return {
                id: document.id,
                name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Untitled issue',
                slug: typeof data.slug === 'string' ? data.slug.trim() : '',
                schoolYear: typeof data.schoolYear === 'string' ? data.schoolYear.trim() : '',
                volumeNumber: Number.isInteger(data.volumeNumber) ? data.volumeNumber : null,
                issueNumber: Number.isInteger(data.issueNumber) ? data.issueNumber : null,
                theme: typeof data.theme === 'string' ? data.theme.trim() : '',
                targetPublicationDate: serializeDate(data.targetPublicationDate),
                publishedAt: serializeDate(data.publishedAt),
                status: data.status,
            };
        })
        .filter((issue) => issue.status === 'published' || (issue.status === 'archived' && issue.publishedAt))
        .sort((a, b) => {
            const aDate = dateFromValue(a.publishedAt || a.targetPublicationDate)?.getTime() || 0;
            const bDate = dateFromValue(b.publishedAt || b.targetPublicationDate)?.getTime() || 0;
            return bDate - aDate || b.name.localeCompare(a.name);
        });

    return {props: {issues}};
}
