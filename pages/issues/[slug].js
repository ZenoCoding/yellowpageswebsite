import Head from 'next/head';
import Link from 'next/link';
import {getApp} from 'firebase/app';
import {collection, getDocs, getFirestore} from 'firebase/firestore';
import Navbar from '../../components/Navbar.js';
import {getAllArticleData} from '../../lib/firebase';

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

const authorLine = (article) => {
    const names = Array.isArray(article.staffNames) && article.staffNames.length > 0
        ? article.staffNames
        : Array.isArray(article.author) ? article.author : [];
    return names.length > 0 ? `By ${names.join(', ')}` : 'The Yellow Pages staff';
};

const issueNumber = (issue) => {
    const parts = [];
    if (issue.volumeNumber) parts.push(`Vol. ${issue.volumeNumber}`);
    if (issue.issueNumber) parts.push(`No. ${issue.issueNumber}`);
    return parts.join(' · ');
};

export default function PublicIssue({issue, articles}) {
    const numbering = issueNumber(issue);
    const publicationDate = formatDate(issue.targetPublicationDate || issue.publishedAt);
    const [leadArticle, ...remainingArticles] = articles;

    return (
        <div className="min-h-screen bg-white text-slate-900">
            <Head>
                <title>{issue.name} | The Yellow Pages</title>
                <meta
                    name="description"
                    content={issue.theme || `Read ${issue.name}, an issue of The Yellow Pages.`}
                />
            </Head>
            <Navbar/>

            <main className="mx-auto max-w-7xl px-4 pb-20 pt-8 sm:px-6 lg:px-8 lg:pt-12">
                <Link
                    href="/issues"
                    className="text-xs font-bold uppercase tracking-[0.25em] text-slate-600 hover:text-yellow-700"
                >
                    <span aria-hidden="true">←</span> All issues
                </Link>

                <header className="mt-6 border-y-4 border-slate-900 bg-yellow-300 px-5 py-9 sm:px-8 sm:py-12 lg:px-12">
                    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-end">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-[0.35em] text-slate-700">
                                {[issue.schoolYear, numbering].filter(Boolean).join(' · ') || 'The Yellow Pages'}
                            </p>
                            <h1 className="mt-4 max-w-4xl text-4xl font-black leading-none tracking-tight sm:text-6xl lg:text-7xl">
                                {issue.name}
                            </h1>
                            {issue.theme && (
                                <p className="mt-5 max-w-3xl text-xl font-medium leading-relaxed text-slate-700">
                                    {issue.theme}
                                </p>
                            )}
                        </div>
                        <div className="border-t border-slate-900/40 pt-4 text-sm font-semibold text-slate-700 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                            {publicationDate && <p>Published {publicationDate}</p>}
                            <p className={publicationDate ? 'mt-1' : ''}>
                                {articles.length} {articles.length === 1 ? 'story' : 'stories'}
                            </p>
                        </div>
                    </div>
                </header>

                {issue.editorNote && (
                    <section className="mx-auto max-w-3xl border-b border-slate-200 py-9 sm:py-12">
                        <p className="text-xs font-bold uppercase tracking-[0.3em] text-yellow-700">From the editors</p>
                        <p className="mt-4 whitespace-pre-line text-lg leading-relaxed text-slate-700">
                            {issue.editorNote}
                        </p>
                    </section>
                )}

                {leadArticle ? (
                    <>
                        <section className="grid gap-7 border-b border-slate-900 py-10 lg:grid-cols-2 lg:items-center lg:py-14">
                            {leadArticle.imageUrl ? (
                                <Link href={`/posts/${leadArticle.id}`} className="block overflow-hidden bg-slate-100">
                                    <img
                                        src={leadArticle.imageUrl}
                                        alt={leadArticle.imageAltText || `Featured image for ${leadArticle.title}`}
                                        className="aspect-[16/10] h-full w-full object-cover transition-transform duration-500 hover:scale-[1.02]"
                                    />
                                </Link>
                            ) : (
                                <div className="hidden aspect-[16/10] bg-slate-100 lg:block" aria-hidden="true"/>
                            )}
                            <article>
                                <p className="text-xs font-bold uppercase tracking-[0.35em] text-yellow-700">From this issue</p>
                                <Link href={`/posts/${leadArticle.id}`} className="group block">
                                    <h2 className="mt-4 text-3xl font-black leading-tight tracking-tight group-hover:text-yellow-700 sm:text-5xl">
                                        {leadArticle.title}
                                    </h2>
                                </Link>
                                {leadArticle.blurb && (
                                    <p className="mt-5 text-lg leading-relaxed text-slate-600">{leadArticle.blurb}</p>
                                )}
                                <p className="mt-5 text-sm font-semibold text-slate-600">
                                    {authorLine(leadArticle)}
                                    {formatDate(leadArticle.date) ? ` · ${formatDate(leadArticle.date)}` : ''}
                                </p>
                            </article>
                        </section>

                        {remainingArticles.length > 0 && (
                            <section className="pt-10 lg:pt-14">
                                <div className="flex items-end justify-between border-b-2 border-slate-900 pb-3">
                                    <h2 className="text-sm font-bold uppercase tracking-[0.35em]">More in this issue</h2>
                                    <span className="text-sm text-slate-500">{remainingArticles.length} more</span>
                                </div>
                                <div className="grid gap-x-8 gap-y-10 pt-8 sm:grid-cols-2 lg:grid-cols-3">
                                    {remainingArticles.map((article) => (
                                        <article key={article.id} className="group border-b border-slate-200 pb-8">
                                            {article.imageUrl && (
                                                <Link href={`/posts/${article.id}`} className="mb-5 block overflow-hidden bg-slate-100">
                                                    <img
                                                        src={article.imageUrl}
                                                        alt={article.imageAltText || `Image for ${article.title}`}
                                                        className="aspect-[16/10] w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                                                        loading="lazy"
                                                    />
                                                </Link>
                                            )}
                                            <Link href={`/posts/${article.id}`} className="block">
                                                <h3 className="text-2xl font-bold leading-snug tracking-tight group-hover:text-yellow-700">
                                                    {article.title}
                                                </h3>
                                            </Link>
                                            {article.blurb && (
                                                <p className="mt-3 line-clamp-3 leading-relaxed text-slate-600">{article.blurb}</p>
                                            )}
                                            <p className="mt-4 text-sm font-semibold text-slate-500">
                                                {authorLine(article)}
                                            </p>
                                        </article>
                                    ))}
                                </div>
                            </section>
                        )}
                    </>
                ) : (
                    <section className="border-b border-slate-200 py-16 text-center">
                        <h2 className="text-2xl font-bold">No stories in this issue.</h2>
                    </section>
                )}
            </main>
        </div>
    );
}

export async function getServerSideProps({params}) {
    const db = getFirestore(getApp());
    const [issueSnapshot, articleData] = await Promise.all([
        getDocs(collection(db, 'issues')),
        getAllArticleData(),
    ]);
    const requestedSlug = Array.isArray(params?.slug) ? params.slug[0] : params?.slug;
    const issueDocument = issueSnapshot.docs.find((document) => {
        const data = document.data() || {};
        return document.id === requestedSlug || data.slug === requestedSlug;
    });

    const requestedIssueData = issueDocument?.data() || null;
    if (!issueDocument || !(requestedIssueData?.status === 'published' || (requestedIssueData?.status === 'archived' && requestedIssueData?.publishedAt))) {
        return {notFound: true};
    }

    const data = issueDocument.data() || {};
    const issue = {
        id: issueDocument.id,
        name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Untitled issue',
        slug: typeof data.slug === 'string' ? data.slug.trim() : '',
        schoolYear: typeof data.schoolYear === 'string' ? data.schoolYear.trim() : '',
        volumeNumber: Number.isInteger(data.volumeNumber) ? data.volumeNumber : null,
        issueNumber: Number.isInteger(data.issueNumber) ? data.issueNumber : null,
        theme: typeof data.theme === 'string' ? data.theme.trim() : '',
        editorNote: typeof data.editorNote === 'string' ? data.editorNote.trim() : '',
        targetPublicationDate: serializeDate(data.targetPublicationDate),
        publishedAt: serializeDate(data.publishedAt),
    };

    // Read issue membership from the raw article records, then enrich from the
    // existing public article mapper. We intentionally do not require a status
    // on articles so older published stories remain compatible.
    const rawArticles = await getDocs(collection(db, 'articles'));
    const articleIds = new Set(rawArticles.docs
        .filter((document) => document.data()?.issueId === issue.id)
        .map((document) => document.id));
    const articles = articleData
        .filter((article) => articleIds.has(article.id))
        .sort((a, b) => {
            const aDate = dateFromValue(a.date)?.getTime() || 0;
            const bDate = dateFromValue(b.date)?.getTime() || 0;
            return bDate - aDate;
        });

    return {props: {issue, articles}};
}
