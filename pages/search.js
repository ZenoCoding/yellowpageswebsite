import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FiSearch } from 'react-icons/fi';
import { format, parseISO } from 'date-fns';
import ContentNavbar from '../components/ContentNavbar';
import { getAllArticleData } from '../lib/firebase';
import { makeCommaSeparatedString } from '../lib/makeCommaSeparatedString';

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeTags = (tags) => {
    if (!tags) return [];
    if (Array.isArray(tags)) {
        return tags.filter(Boolean);
    }
    if (typeof tags === 'string') {
        return tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean);
    }
    return [];
};

const getFormattedDate = (date) => {
    if (!date) return null;
    try {
        return format(parseISO(date), 'LLLL d, yyyy');
    } catch (error) {
        return null;
    }
};

const extractStaffNames = (article) => {
    if (!article) return [];
    if (Array.isArray(article.staffNames) && article.staffNames.length > 0) {
        return article.staffNames;
    }
    if (Array.isArray(article.author)) {
        return article.author.filter((name) => typeof name === 'string' && name.trim().length > 0);
    }
    if (typeof article.author === 'string') {
        return article.author
            .split(',')
            .map((name) => name.trim())
            .filter((name) => name.length > 0);
    }
    return [];
};

export default function Search({ allArticleData }) {
    const router = useRouter();
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        if (!router.isReady) return;
        const queryValue = typeof router.query?.query === 'string' ? router.query.query : '';
        setSearchTerm((previous) => (previous === queryValue ? previous : queryValue));
    }, [router.isReady, router.query?.query]);

    const normalizedTerm = searchTerm.trim().toLowerCase();

    const searchResults = useMemo(() => {
        if (!normalizedTerm) {
            return allArticleData;
        }

        return allArticleData.filter((article) => {
            const haystacks = [
                article.title,
                article.blurb,
                article.category,
                extractStaffNames(article).join(' '),
                Array.isArray(article.tags) ? article.tags.join(' ') : article.tags,
            ].filter(Boolean);

            return haystacks.some((field) =>
                field.toString().toLowerCase().includes(normalizedTerm)
            );
        });
    }, [normalizedTerm, allArticleData]);

    const syncQueryString = useCallback(
        (value) => {
            const trimmed = value.trim();
            setSearchTerm(trimmed);
            router.replace(
                {
                    pathname: '/search',
                    query: trimmed ? { query: trimmed } : {},
                },
                undefined,
                { shallow: true }
            );
        },
        [router, setSearchTerm]
    );

    const handleSearchChange = (event) => {
        setSearchTerm(event.target.value);
    };

    const handleSearchSubmit = (event) => {
        event.preventDefault();
        syncQueryString(searchTerm);
    };

    const handleClearSearch = () => {
        syncQueryString('');
    };

    const highlightMatch = useCallback(
        (text) => {
            if (!text || !normalizedTerm) return text;
            const pattern = new RegExp(`(${escapeRegExp(normalizedTerm)})`, 'ig');
            return text.split(pattern).map((segment, index) => {
                if (segment.toLowerCase() === normalizedTerm) {
                    return (
                        <mark
                            key={`${segment}-${index}`}
                            className="rounded-sm bg-yellow-200 px-1 py-0.5 text-slate-900"
                        >
                            {segment}
                        </mark>
                    );
                }
                return segment;
            });
        },
        [normalizedTerm]
    );

    const activePhrase = searchTerm.trim();
    const hasActiveSearch = Boolean(activePhrase);
    const resultCount = searchResults.length;

    return (
        <div className="min-h-screen bg-white">
            <ContentNavbar />
            <main className="mx-auto max-w-5xl px-4 pb-12 pt-8 sm:px-6 lg:px-8">
                <section className="rounded-3xl border border-yellow-200 bg-yellow-50/60 p-6 sm:p-8">
                    <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">
                        Find stories worth sharing
                    </h1>
                    <p className="mt-2 text-sm text-slate-600 sm:text-base">
                        {hasActiveSearch
                            ? `Found ${resultCount} result${resultCount === 1 ? '' : 's'} for "${activePhrase}".`
                            : `Search across ${allArticleData.length} stories. Try titles, staff names, tags, or keywords.`}
                    </p>
                    <form
                        onSubmit={handleSearchSubmit}
                        role="search"
                        className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center"
                    >
                        <div className="group relative flex-1">
                            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                                <FiSearch size={20} />
                            </span>
                            <label htmlFor="search-input" className="sr-only">
                                Search for articles
                            </label>
                            <input
                                id="search-input"
                                type="search"
                                value={searchTerm}
                                onChange={handleSearchChange}
                                placeholder="Search for news, people, places, and more..."
                                className="w-full rounded-xl border border-transparent bg-white py-3 pl-12 pr-4 text-base text-slate-900 shadow-sm transition focus:border-yellow-400 focus:outline-none focus:ring-2 focus:ring-yellow-300"
                            />
                        </div>
                        <div className="flex gap-3">
                            <button
                                type="submit"
                                className="flex items-center justify-center rounded-xl bg-yellow-400 px-5 py-3 text-sm font-semibold text-slate-900 transition hover:bg-yellow-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-500"
                            >
                                Search
                            </button>
                            {hasActiveSearch && (
                                <button
                                    type="button"
                                    onClick={handleClearSearch}
                                    className="flex items-center justify-center rounded-xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-500"
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                    </form>
                </section>

                <section className="mt-10">
                    {resultCount > 0 ? (
                        <div className="space-y-6">
                            {searchResults.map((article) => {
                                const {
                                    id,
                                    date,
                                    title,
                                    tags,
                                    blurb,
                                    thumbnail,
                                    imageUrl,
                                } = article;
                                const staffNames = extractStaffNames(article);

                                const formattedDate = getFormattedDate(date);
                                const articleTags = normalizeTags(tags);
                                const previewImage = thumbnail || imageUrl;
                                const previewAlt = (article.imageAltText && article.imageAltText.trim().length > 0)
                                    ? article.imageAltText
                                    : `Preview image for ${title}`;

                                const layoutClasses = previewImage
                                    ? 'grid gap-0 md:grid-cols-[220px,1fr]'
                                    : 'grid gap-0';

                                return (
                                    <Link
                                        key={id}
                                        href={`/posts/${id}`}
                                        className="group block overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:border-yellow-300 hover:shadow-lg"
                                    >
                                        <div className={layoutClasses}>
                                            {previewImage && (
                                                <div className="relative hidden h-full overflow-hidden bg-yellow-100 md:block">
                                                    <img
                                                        src={previewImage}
                                                        alt={previewAlt}
                                                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                                                    />
                                                </div>
                                            )}
                                            <div className="flex flex-col gap-4 p-6 sm:p-7">
                                                <div className="flex flex-wrap items-center gap-3 text-xs font-medium uppercase tracking-[0.25em] text-slate-500">
                                                    {formattedDate && (
                                                        <time dateTime={date}>{formattedDate}</time>
                                                    )}
                                                    {articleTags.slice(0, 3).map((tag) => (
                                                        <span
                                                            key={tag}
                                                            className="rounded-full border border-yellow-200 bg-yellow-50 px-3 py-1 text-[0.65rem] font-semibold tracking-[0.2em] text-yellow-700"
                                                        >
                                                            {tag}
                                                        </span>
                                                    ))}
                                                </div>
                                                <h2 className="text-2xl font-semibold leading-snug text-slate-900 transition-colors group-hover:text-yellow-700">
                                                    {highlightMatch(title)}
                                                </h2>
                                                {blurb && (
                                                    <p className="text-sm leading-relaxed text-slate-700">
                                                        {highlightMatch(blurb)}
                                                    </p>
                                                )}
                                                <p className="text-xs font-medium uppercase tracking-[0.25em] text-slate-500">
                                                    By {makeCommaSeparatedString(staffNames)}
                                                </p>
                                            </div>
                                        </div>
                                    </Link>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="rounded-3xl border border-dashed border-yellow-300 bg-yellow-50/80 p-10 text-center">
                            <p className="text-lg font-semibold text-slate-900">
                                Nothing matched &ldquo;{activePhrase}&rdquo; just yet.
                            </p>
                            <p className="mt-2 text-sm text-slate-600">
                                Try a different combination of keywords, check your spelling, or explore our
                                latest categories.
                            </p>
                            <div className="mt-6 flex flex-wrap justify-center gap-3 text-sm font-semibold text-yellow-700">
                                {['News', 'Opinion', 'Feature', 'Sports', 'Local'].map((suggestion) => (
                                    <button
                                        key={suggestion}
                                        type="button"
                                        onClick={() => syncQueryString(suggestion)}
                                        className="rounded-full border border-yellow-200 bg-white px-4 py-2 transition hover:border-yellow-300 hover:bg-yellow-100"
                                    >
                                        {suggestion}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </section>
            </main>
        </div>
    );
}

export async function getServerSideProps() {
    const allArticleData = await getAllArticleData();
    return {
        props: {
            allArticleData,
        },
    };
}
