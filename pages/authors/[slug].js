import Head from 'next/head';
import Link from 'next/link';
import {getApp} from 'firebase/app';
import {
    collection,
    getDocs,
    getFirestore,
    query,
    where,
} from 'firebase/firestore';
import DateDisplay from '../../components/date';
import {getAuthorDirectoryForServer, buildStaffDataForArticle} from '../../lib/firebase';
import {makeCommaSeparatedString} from '../../lib/makeCommaSeparatedString';

const app = getApp();
const db = getFirestore(app);

const normalizeTagList = (value) => {
    if (Array.isArray(value)) {
        return value
            .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
            .filter((tag) => tag.length > 0);
    }
    if (typeof value === 'string') {
        return value
            .split(',')
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0);
    }
    return [];
};

const toIsoString = (value) => {
    if (!value) {
        return null;
    }
    if (typeof value === 'string') {
        return value;
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (typeof value?.toDate === 'function') {
        try {
            return value.toDate().toISOString();
        } catch (error) {
            return null;
        }
    }
    return null;
};

const toComparableTimestamp = (value) => {
    if (!value) {
        return Number.NEGATIVE_INFINITY;
    }
    if (value instanceof Date) {
        return value.getTime();
    }
    if (typeof value?.toDate === 'function') {
        try {
            return value.toDate().getTime();
        } catch (error) {
            return Number.NEGATIVE_INFINITY;
        }
    }
    if (typeof value === 'string') {
        const parsed = globalThis.Date.parse(value);
        return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
    }
    return Number.NEGATIVE_INFINITY;
};

const findAuthorRecord = (directory, slugOrId) => {
    if (!slugOrId || typeof slugOrId !== 'string') {
        return null;
    }
    const directMatch = directory.get(slugOrId);
    if (directMatch) {
        return directMatch;
    }
    const normalizedSlug = slugOrId.trim().toLowerCase();
    for (const author of directory.values()) {
        if (!author) continue;
        if (typeof author.authorSlug === 'string' && author.authorSlug.trim().toLowerCase() === normalizedSlug) {
            return author;
        }
    }
    return null;
};

const collectArticleSnapshots = async (authorId) => {
    const snapshotMap = new Map();
    try {
        const authorQuery = query(collection(db, 'articles'), where('authorIds', 'array-contains', authorId));
        const querySnapshot = await getDocs(authorQuery);
        querySnapshot.forEach((docSnapshot) => {
            snapshotMap.set(docSnapshot.id, docSnapshot);
        });
    } catch (error) {
        if (error?.code !== 'failed-precondition') {
            throw error;
        }
        const allSnapshot = await getDocs(collection(db, 'articles'));
        allSnapshot.forEach((docSnapshot) => {
            const data = docSnapshot.data() || {};
            const authorIds = Array.isArray(data.authorIds)
                ? data.authorIds.filter((value) => typeof value === 'string')
                : [];
            if (authorIds.includes(authorId)) {
                snapshotMap.set(docSnapshot.id, docSnapshot);
            }
        });
    }
    return Array.from(snapshotMap.values());
};

const buildArticleSummaries = async (authorRecord, authorDirectory) => {
    const articleSnapshots = await collectArticleSnapshots(authorRecord.id);
    const summaries = articleSnapshots.map((docSnapshot) => {
        const data = docSnapshot.data() || {};
        const staffData = buildStaffDataForArticle(data, authorDirectory);
        const staffNames = Array.isArray(staffData?.staffNames) ? staffData.staffNames : [];

        return {
            id: docSnapshot.id,
            title:
                typeof data.title === 'string' && data.title.trim().length > 0
                    ? data.title.trim()
                    : 'Untitled article',
            date: toIsoString(data.date),
            blurb: typeof data.blurb === 'string' && data.blurb.trim().length > 0 ? data.blurb.trim() : null,
            tags: normalizeTagList(data.tags),
            byline: staffNames.length > 0 ? `By ${makeCommaSeparatedString(staffNames, true)}` : null,
            imageUrl: typeof data.imageUrl === 'string' && data.imageUrl.trim().length > 0 ? data.imageUrl.trim() : null,
            sortKey: toComparableTimestamp(data.date),
        };
    });

    summaries.sort((a, b) => {
        const diff = (b.sortKey || Number.NEGATIVE_INFINITY) - (a.sortKey || Number.NEGATIVE_INFINITY);
        if (Number.isFinite(diff) && diff !== 0) {
            return diff;
        }
        return a.title.localeCompare(b.title);
    });

    return summaries.map(({sortKey, ...rest}) => rest);
};

const buildAuthorPayload = (record) => {
    return {
        id: record.id,
        fullName: typeof record.fullName === 'string' && record.fullName.trim().length > 0 ? record.fullName.trim() : 'Yellow Pages Staff',
        photoUrl: typeof record.photoUrl === 'string' && record.photoUrl.trim().length > 0 ? record.photoUrl.trim() : null,
        bio: typeof record.bio === 'string' ? record.bio : '',
        position: typeof record.position === 'string' && record.position.trim().length > 0 ? record.position.trim() : null,
        graduationYear: typeof record.graduationYear === 'number' ? record.graduationYear : null,
        authorSlug: typeof record.authorSlug === 'string' && record.authorSlug.trim().length > 0 ? record.authorSlug.trim() : null,
        hasDeparted: typeof record.hasDeparted === 'boolean' ? record.hasDeparted : false,
    };
};

const initialsFromName = (name) => {
    if (typeof name !== 'string' || name.trim().length === 0) {
        return 'YP';
    }
    const tokens = name
        .split(' ')
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
        .slice(0, 2);
    if (tokens.length === 0) {
        return 'YP';
    }
    return tokens.map((token) => token[0].toUpperCase()).join('');
};

const buildMetaDetails = (author) => {
    const meta = [];
    if (author.position) {
        meta.push(author.position);
    }
    if (author.graduationYear) {
        meta.push(`Class of ${author.graduationYear}`);
    }
    if (author.hasDeparted) {
        meta.push('Alumni');
    }
    return meta;
};

const formatArticleCountLabel = (count) => {
    if (count === 0) {
        return 'No published pieces yet';
    }
    if (count === 1) {
        return '1 published piece';
    }
    return `${count} published pieces`;
};

export default function AuthorPage({author, articles}) {
    if (!author) {
        return null;
    }

    const metaDetails = buildMetaDetails(author);
    const hasArticles = Array.isArray(articles) && articles.length > 0;

    return (
        <>
            <Head>
                <title>{author.fullName} | Yellow Pages</title>
                <meta name="description" content={`Browse stories by ${author.fullName} on Yellow Pages.`}/>
            </Head>
            <div className="min-h-screen bg-slate-50">
                <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-16 lg:px-8">
                    <Link href="/" className="text-sm font-medium text-slate-600 transition hover:text-yellow-600">
                        ← Back to latest
                    </Link>
                    <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-md sm:p-8">
                        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-10">
                            <div className="mx-auto flex h-32 w-32 flex-shrink-0 items-center justify-center overflow-hidden rounded-3xl bg-yellow-100 sm:mx-0 sm:h-40 sm:w-40">
                                {author.photoUrl ? (
                                    <img
                                        src={author.photoUrl}
                                        alt={`Portrait of ${author.fullName}`}
                                        className="h-full w-full object-cover"
                                        loading="lazy"
                                        decoding="async"
                                    />
                                ) : (
                                    <span className="text-3xl font-semibold uppercase text-yellow-700">
                                        {initialsFromName(author.fullName)}
                                    </span>
                                )}
                            </div>
                            <div className="flex-1">
                                <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                                    {author.fullName}
                                </h1>
                                {metaDetails.length > 0 && (
                                    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm font-medium text-slate-600">
                                        {metaDetails.map((detail) => (
                                            <span
                                                key={detail}
                                                className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs uppercase tracking-wide text-slate-600"
                                            >
                                                {detail}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                {author.bio && author.bio.trim().length > 0 && (
                                    <p className="mt-4 whitespace-pre-line text-base leading-relaxed text-slate-700">
                                        {author.bio}
                                    </p>
                                )}
                                <p className="mt-5 text-sm font-medium uppercase tracking-wide text-slate-500">
                                    {formatArticleCountLabel(Array.isArray(articles) ? articles.length : 0)}
                                </p>
                            </div>
                        </div>
                    </div>

                    <section className="mt-12">
                        <div className="flex items-baseline justify-between gap-4">
                            <h2 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                                Latest from {author.fullName}
                            </h2>
                            {hasArticles && (
                                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Updated automatically
                                </span>
                            )}
                        </div>
                        {hasArticles ? (
                            <ul className="mt-6 list-none divide-y divide-slate-200 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                                {articles.map((article) => (
                                    <li
                                        key={article.id}
                                        className="group flex flex-col overflow-hidden bg-white transition sm:flex-row sm:items-stretch"
                                    >
                                        {article.imageUrl && (
                                            <Link
                                                href={`/posts/${article.id}`}
                                                className="relative block w-full overflow-hidden sm:w-[22rem] sm:flex-shrink-0 sm:self-stretch sm:border-r sm:border-slate-200"
                                            >
                                                <img
                                                    src={article.imageUrl}
                                                    alt={`Cover image for ${article.title}`}
                                                    className="h-56 w-full object-cover sm:h-full"
                                                    loading="lazy"
                                                    decoding="async"
                                                />
                                            </Link>
                                        )}
                                        <div className="flex flex-1 flex-col gap-3 p-6 transition-colors group-hover:bg-yellow-50 sm:p-8 sm:group-hover:bg-yellow-50">
                                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                                <Link
                                                    href={`/posts/${article.id}`}
                                                    className="text-xl font-semibold text-slate-900 transition-colors duration-300 group-hover:text-yellow-700 sm:text-2xl"
                                                >
                                                    {article.title}
                                                </Link>
                                                {article.date && (
                                                    <div className="text-sm font-semibold text-slate-500">
                                                        <DateDisplay dateString={article.date}/>
                                                    </div>
                                                )}
                                            </div>
                                            {article.byline && (
                                                <p className="text-sm font-medium text-slate-600">
                                                    {article.byline}
                                                </p>
                                            )}
                                            {article.blurb && (
                                                <p className="text-sm leading-relaxed text-slate-700">
                                                    {article.blurb}
                                                </p>
                                            )}
                                            {article.tags && article.tags.length > 0 && (
                                                <div className="flex flex-wrap gap-2">
                                                    {article.tags.map((tag) => (
                                                        <span
                                                            key={tag}
                                                            className="inline-flex items-center rounded-full border border-yellow-300 bg-yellow-100 px-2.5 py-1 text-xs font-medium text-yellow-800"
                                                        >
                                                            {tag}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-white/60 p-10 text-center">
                                <p className="text-sm font-medium text-slate-600">
                                    We haven&apos;t published any articles from {author.fullName} yet. Check back soon!
                                </p>
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </>
    );
}

export async function getServerSideProps({params}) {
    const slugParam = Array.isArray(params?.slug) ? params.slug[0] : params?.slug;
    if (!slugParam || typeof slugParam !== 'string') {
        return {
            notFound: true,
        };
    }

    const authorDirectory = await getAuthorDirectoryForServer();
    const authorRecord = findAuthorRecord(authorDirectory, slugParam);
    if (!authorRecord) {
        return {
            notFound: true,
        };
    }

    const articles = await buildArticleSummaries(authorRecord, authorDirectory);

    return {
        props: {
            author: buildAuthorPayload(authorRecord),
            articles,
        },
    };
}
