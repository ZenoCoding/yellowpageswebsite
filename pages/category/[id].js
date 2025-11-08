import { useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Navbar from '../../components/Navbar.js';
import { getAllArticleData } from '../../lib/firebase';
import { makeCommaSeparatedString } from '../../lib/makeCommaSeparatedString';
import { format as formatDate, isValid as isValidDate, parseISO } from 'date-fns';

const SECTION_METADATA = {
    news: {
        title: 'News',
        heroLabel: 'News Desk',
        description: 'Reporting on the policy shifts, campus happenings, and announcements shaping BIFU Fremont.',
    },
    feature: {
        title: 'Feature',
        heroLabel: 'Feature Spotlight',
        description: 'Long-form, deeply reported storytelling that adds dimension to student life and the broader community.',
    },
    opinion: {
        title: 'Opinion',
        heroLabel: 'Editorial Board',
        description: 'Arguments, ideas, and perspectives from the Yellow Pages opinion desk.',
    },
    sports: {
        title: 'Sports',
        heroLabel: 'Sports Beat',
        description: 'Scores, strategy, and behind-the-scenes looks at BIFU Fremont athletics.',
    },
    ae: {
        title: 'A&E',
        heroLabel: 'Arts & Entertainment',
        description: 'Spotlighting creativity across BIFU Fremont — concerts, galleries, films, and more.',
    },
    hob: {
        title: 'Humans of BASIS',
        heroLabel: 'Profiles',
        description: 'Personal spotlights on the students, teachers, and staff who make BIFU Fremont unique.',
    },
};

const CATEGORY_SYNONYMS = {
    news: ['news'],
    feature: ['feature', 'features'],
    opinion: ['opinion', 'op-ed', 'editorial'],
    sports: ['sports', 'sport', 'athletics'],
    ae: ['ae', 'a&e', 'arts & entertainment', 'arts and entertainment'],
    hob: ['hob', 'humans of basis'],
};

const RECENT_TREND_WINDOW_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

const parseDateValue = (value) => {
    if (!value) {
        return null;
    }
    if (value instanceof Date && isValidDate(value)) {
        return value;
    }
    if (typeof value === 'object') {
        if (typeof value.toDate === 'function') {
            try {
                const dateValue = value.toDate();
                return isValidDate(dateValue) ? dateValue : null;
            } catch (error) {
                return null;
            }
        }
        if (typeof value.seconds === 'number') {
            try {
                const candidate = new Date(value.seconds * 1000);
                return isValidDate(candidate) ? candidate : null;
            } catch (error) {
                return null;
            }
        }
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }
        const parsedIso = parseISO(trimmed);
        if (isValidDate(parsedIso)) {
            return parsedIso;
        }
        const fallback = new Date(trimmed);
        if (!Number.isNaN(fallback.getTime())) {
            return fallback;
        }
    }
    return null;
};

const getStaffNames = (article) => {
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

const buildByline = (article) => {
    const staffNames = getStaffNames(article);
    if (staffNames.length > 0) {
        return `By ${makeCommaSeparatedString(staffNames)}`;
    }
    return 'By Yellow Pages Staff';
};

const getPhotoCredit = (article) => {
    const creditSources = [
        article?.featuredImage?.credit,
        article?.imageCredit,
        article?.photoCredit,
        article?.photographer,
    ];

    const credit = creditSources.find((value) => typeof value === 'string' && value.trim().length > 0);
    return credit ? credit.trim() : null;
};

const getImageCaption = (article) => {
    const captionSources = [
        article?.featuredImage?.caption,
        article?.imageCaption,
        article?.caption,
    ];
    const caption = captionSources.find((value) => typeof value === 'string' && value.trim().length > 0);
    return caption ? caption.trim() : null;
};

const getImageAltText = (article, fallback) => {
    const altSources = [article?.featuredImage?.altText, article?.imageAltText];
    const alt = altSources.find((value) => typeof value === 'string' && value.trim().length > 0);
    return alt || fallback || 'Article image';
};

const getViewCount = (article) => {
    const value = article?.viewCount;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return value;
    }
    return 0;
};

const getLastViewedDate = (article) => parseDateValue(article?.lastViewedAt) || parseDateValue(article?.date);

const formatArticleDate = (article) => {
    const dateValue = parseDateValue(article?.date);
    if (!dateValue) {
        return null;
    }
    return formatDate(dateValue, 'MMMM d, yyyy');
};

const ImageMeta = ({ credit, caption, className = '', variant = 'stacked' }) => {
    if (!credit && !caption) {
        return null;
    }
    if (variant === 'hero') {
        return (
            <p className={`mt-1 text-[0.55rem] font-medium uppercase tracking-[0.25em] text-slate-400 ${className}`.trim()}>
                {credit}
                {credit && caption ? ' • ' : ''}
                {caption && (
                    <span className="normal-case tracking-normal text-[0.65rem] italic text-slate-500">
                        {caption}
                    </span>
                )}
            </p>
        );
    }
    const baseClasses = `mt-1 text-left text-[0.55rem] leading-tight text-slate-500 ${className}`.trim();
    return (
        <p className={baseClasses}>
            {credit && (
                <span className="block font-semibold uppercase tracking-[0.25em] text-[0.55rem] text-slate-500">
                    {credit}
                </span>
            )}
            {caption && (
                <span className={`block text-[0.6rem] italic text-slate-500 ${credit ? 'mt-0.5' : ''}`}>
                    {caption}
                </span>
            )}
        </p>
    );
};

const getMetadataForSection = (sectionId) => {
    if (sectionId && SECTION_METADATA[sectionId]) {
        return SECTION_METADATA[sectionId];
    }
    if (sectionId) {
        const fallbackTitle = sectionId.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
        return {
            title: fallbackTitle,
            heroLabel: 'Section Lead',
            description: `Latest coverage from the ${fallbackTitle} desk.`,
        };
    }
    return {
        title: 'Section',
        heroLabel: 'Section Lead',
        description: 'Latest coverage from this section.',
    };
};

const getCategoryCandidates = (sectionId) => {
    if (!sectionId) {
        return [];
    }
    const base = sectionId.trim().toLowerCase();
    const synonyms = CATEGORY_SYNONYMS[base] || [base];
    return Array.from(
        new Set(
            synonyms
                .concat(base)
                .map((value) => value.trim().toLowerCase())
                .filter((value) => value.length > 0)
        )
    );
};

const matchesCategory = (article, sectionId) => {
    const candidates = getCategoryCandidates(sectionId);
    if (candidates.length === 0) {
        return false;
    }

    const extractTags = (value) => {
        if (Array.isArray(value)) {
            return value;
        }
        if (typeof value === 'string') {
            return value.split(',').map((tag) => tag.trim());
        }
        return [];
    };

    const articleTags = extractTags(article?.tags)
        .map((tag) => tag && tag.toLowerCase())
        .filter(Boolean);

    if (articleTags.some((tag) => candidates.includes(tag))) {
        return true;
    }

    if (typeof article?.category === 'string') {
        const normalizedCategory = article.category.trim().toLowerCase();
        return candidates.some((candidate) => normalizedCategory.includes(candidate));
    }

    return false;
};

const sortByPublishedDate = (a, b) => {
    const dateA = parseDateValue(a?.date);
    const dateB = parseDateValue(b?.date);
    if (dateA && dateB) {
        return dateB.getTime() - dateA.getTime();
    }
    if (dateA) {
        return -1;
    }
    if (dateB) {
        return 1;
    }
    return getViewCount(b) - getViewCount(a);
};

export default function SectionPage({ sectionId, sectionName, sectionDescription, articles }) {
    const {
        heroArticle,
        headlineStack,
        featureGrid,
        archiveStories,
        trendingStories,
    } = useMemo(() => {
        const dataset = Array.isArray(articles) ? articles.filter(Boolean) : [];
        if (dataset.length === 0) {
            return {
                heroArticle: null,
                headlineStack: [],
                featureGrid: [],
                archiveStories: [],
                trendingStories: [],
            };
        }

        const sortedByDate = [...dataset].sort(sortByPublishedDate);
        const hero = sortedByDate.find((article) => typeof article?.imageUrl === 'string' && article.imageUrl.trim().length > 0) || sortedByDate[0] || null;
        const remaining = hero ? sortedByDate.filter((article) => article.id !== hero.id) : sortedByDate;

        const headlineList = remaining.slice(0, 4);
        const featureList = remaining.slice(4, 10);
        const archiveList = remaining.slice(10);

        const now = Date.now();
        const sortableArticles = [...dataset].sort((a, b) => {
            const diff = getViewCount(b) - getViewCount(a);
            if (diff !== 0) {
                return diff;
            }
            return sortByPublishedDate(a, b);
        });

        const recentArticles = [];
        const fallbackArticles = [];

        sortableArticles.forEach((article) => {
            const lastViewedDate = getLastViewedDate(article);
            if (lastViewedDate && now - lastViewedDate.getTime() <= RECENT_TREND_WINDOW_MS) {
                recentArticles.push(article);
            } else {
                fallbackArticles.push(article);
            }
        });

        const trending = [...recentArticles, ...fallbackArticles].slice(0, 5);

        return {
            heroArticle: hero,
            headlineStack: headlineList,
            featureGrid: featureList,
            archiveStories: archiveList,
            trendingStories: trending,
        };
    }, [articles]);

    const renderHeroStory = (article) => {
        if (!article) {
            return null;
        }
        const publishedOn = formatArticleDate(article);
        const photoCredit = getPhotoCredit(article);
        const imageCaption = getImageCaption(article);
        const altText = getImageAltText(article, `Cover image for ${article.title}`);

        return (
            <article className="space-y-4 border-b border-slate-200 pb-8 lg:border-0 lg:pb-0">
                {article.imageUrl && (
                    <div>
                        <div className="overflow-hidden rounded-sm bg-slate-100">
                            <div className="aspect-[16/9] overflow-hidden">
                                <img
                                    src={article.imageUrl}
                                    alt={altText}
                                    className="h-full w-full object-cover"
                                    loading="eager"
                                    decoding="async"
                                />
                            </div>
                        </div>
                        <ImageMeta credit={photoCredit} caption={imageCaption} variant="hero" />
                    </div>
                )}
                <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-500">
                        {SECTION_METADATA[sectionId]?.heroLabel || 'Section Lead'}
                    </p>
                    <Link href={`/posts/${article.id}`} className="group block">
                        <h1 className="text-3xl font-black leading-tight tracking-tight text-slate-900 transition-colors duration-200 group-hover:text-yellow-700 sm:text-4xl">
                            {article.title}
                        </h1>
                    </Link>
                    {article.blurb && (
                        <p className="text-lg leading-relaxed text-slate-700">
                            {article.blurb}
                        </p>
                    )}
                    <p className="text-sm font-medium text-slate-600">
                        {buildByline(article)}
                        {publishedOn ? ` • ${publishedOn}` : ''}
                    </p>
                </div>
            </article>
        );
    };

    const renderHeadlineStack = (articlesForStack) => {
        if (!articlesForStack || articlesForStack.length === 0) {
            return (
                <aside className="border-t border-slate-200 pt-6 lg:border-0 lg:pt-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-500">
                        Latest Headlines
                    </p>
                    <p className="mt-4 text-sm text-slate-600">
                        Fresh coverage is on the way.
                    </p>
                </aside>
            );
        }

        return (
            <aside className="flex h-full flex-col border-t border-slate-200 pt-6 lg:border-0 lg:pt-0">
                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-500">
                    Latest Headlines
                </p>
                <div className="mt-5 flex-1 space-y-6">
                    {articlesForStack.map((article, index) => {
                        const hasImage = typeof article.imageUrl === 'string' && article.imageUrl.trim().length > 0;
                        const altText = getImageAltText(article, `Thumbnail for ${article.title}`);
                        return (
                            <div
                                key={article.id}
                                className={`${index === 0 ? '' : 'border-t border-slate-200 pt-6'}`}
                            >
                                <div
                                    className={`group ${hasImage ? 'lg:grid lg:grid-cols-[120px_minmax(0,1fr)] lg:items-start lg:gap-4' : ''}`}
                                >
                                    {hasImage && (
                                        <div className="mr-0 mb-3 hidden lg:mb-0 lg:block">
                                            <div className="overflow-hidden rounded-sm bg-slate-100">
                                                <img
                                                    src={article.imageUrl}
                                                    alt={altText}
                                                    className="h-24 w-28 object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                                                    loading="lazy"
                                                    decoding="async"
                                                />
                                            </div>
                                        </div>
                                    )}
                                    <div>
                                        <Link href={`/posts/${article.id}`} className="block">
                                            <h3 className="text-xl font-semibold leading-snug text-slate-900 transition-colors duration-200 group-hover:text-yellow-700">
                                                {article.title}
                                            </h3>
                                        </Link>
                                        <p className="mt-2 text-sm font-medium text-slate-600">
                                            {buildByline(article)}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </aside>
        );
    };

    const renderTrendingList = (articlesForTrending) => {
        if (!articlesForTrending || articlesForTrending.length === 0) {
            return null;
        }

        const hasViewData = articlesForTrending.some((article) => getViewCount(article) > 0);

        return (
            <section>
                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-500">
                    Trending in {sectionName}
                </p>
                <ol className="mt-4 divide-y divide-slate-200 border-y border-slate-200">
                    {articlesForTrending.map((article, index) => {
                        const views = getViewCount(article);
                        const hasImage = typeof article.imageUrl === 'string' && article.imageUrl.trim().length > 0;
                        const altText = getImageAltText(article, `Thumbnail for ${article.title}`);
                        return (
                            <li key={article.id} className="py-4">
                                <div className="flex items-center gap-4">
                                    <span className="text-3xl font-black leading-none tracking-tight text-slate-900">
                                        {index + 1}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <Link href={`/posts/${article.id}`} className="block">
                                            <h3 className="text-base font-semibold leading-snug text-slate-900 transition-colors duration-200 hover:text-yellow-700">
                                                {article.title}
                                            </h3>
                                        </Link>
                                        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                                            {hasViewData && (
                                                <span className="font-semibold text-slate-600">
                                                    {views.toLocaleString()} {views === 1 ? 'view' : 'views'}
                                                </span>
                                            )}
                                            <span>{buildByline(article)}</span>
                                        </div>
                                    </div>
                                    {hasImage && (
                                        <div className="hidden shrink-0 overflow-hidden rounded-sm sm:block">
                                            <img
                                                src={article.imageUrl}
                                                alt={altText}
                                                className="h-16 w-16 object-cover"
                                                loading="lazy"
                                                decoding="async"
                                            />
                                        </div>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ol>
                {!hasViewData && (
                    <p className="pt-2 text-[0.65rem] font-medium uppercase tracking-[0.2em] text-slate-400">
                        View counts will appear as readers arrive.
                    </p>
                )}
            </section>
        );
    };

    const renderFeatureGrid = (articlesForGrid) => {
        if (!articlesForGrid || articlesForGrid.length === 0) {
            return null;
        }

        return (
            <section>
                <header className="border-b border-slate-200 pb-2">
                    <h2 className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-600">
                        Section Highlights
                    </h2>
                </header>
                <div className="mt-6 grid gap-8 sm:grid-cols-2">
                    {articlesForGrid.map((article) => {
                        const publishedOn = formatArticleDate(article);
                        const altText = getImageAltText(article, `Cover image for ${article.title}`);
                        return (
                            <article key={article.id} className="space-y-3">
                                {article.imageUrl && (
                                    <div className="overflow-hidden rounded-sm bg-slate-100">
                                        <div className="aspect-[3/2] overflow-hidden">
                                            <img
                                                src={article.imageUrl}
                                                alt={altText}
                                                className="h-full w-full object-cover transition-transform duration-500 hover:scale-[1.02]"
                                                loading="lazy"
                                                decoding="async"
                                            />
                                        </div>
                                    </div>
                                )}
                                <Link href={`/posts/${article.id}`} className="group block">
                                    <h3 className="text-2xl font-semibold leading-snug text-slate-900 transition-colors duration-200 group-hover:text-yellow-700">
                                        {article.title}
                                    </h3>
                                </Link>
                                <p className="text-sm font-medium text-slate-600">
                                    {buildByline(article)}
                                    {publishedOn ? ` • ${publishedOn}` : ''}
                                </p>
                                {article.blurb && (
                                    <p className="text-sm leading-relaxed text-slate-600">
                                        {article.blurb}
                                    </p>
                                )}
                            </article>
                        );
                    })}
                </div>
            </section>
        );
    };

    const renderArchiveList = (articlesForArchive) => {
        if (!articlesForArchive || articlesForArchive.length === 0) {
            return null;
        }

        return (
            <section className="border-t border-slate-200 pt-6">
                <header className="pb-4">
                    <h2 className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-600">
                        More from {sectionName}
                    </h2>
                </header>
                <div className="space-y-6">
                    {articlesForArchive.map((article) => {
                        const publishedOn = formatArticleDate(article);
                        return (
                            <article key={article.id} className="border-b border-slate-200 pb-4 last:border-b-0 last:pb-0">
                                <Link href={`/posts/${article.id}`} className="group block">
                                    <h3 className="text-lg font-semibold leading-snug text-slate-900 transition-colors duration-200 group-hover:text-yellow-700">
                                        {article.title}
                                    </h3>
                                </Link>
                                <p className="mt-2 text-sm font-medium text-slate-600">
                                    {buildByline(article)}
                                    {publishedOn ? ` • ${publishedOn}` : ''}
                                </p>
                            </article>
                        );
                    })}
                </div>
            </section>
        );
    };

    const hasArticles = Array.isArray(articles) && articles.length > 0;

    return (
        <div className="min-h-screen bg-white">
            <Head>
                <title>{sectionName} | Yellow Pages</title>
                <meta
                    name="description"
                    content={sectionDescription}
                />
                <meta property="og:title" content={`${sectionName} | Yellow Pages`} />
                <meta property="og:description" content={sectionDescription} />
            </Head>
            <Navbar />
            <main className="mx-auto max-w-[88rem] px-4 pb-12 pt-8 sm:px-6 lg:px-10">
                <header className="border-b border-slate-200 pb-8">
                    <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-500">
                                Section
                            </p>
                            <div className="mt-3">
                                <h1 className="text-4xl font-black tracking-tight text-slate-900 sm:text-5xl">
                                    {sectionName}
                                </h1>
                                <p className="mt-4 max-w-3xl text-base leading-relaxed text-slate-600">
                                    {sectionDescription}
                                </p>
                            </div>
                        </div>
                        {hasArticles && (
                            <p className="text-sm font-medium text-slate-500 lg:self-end lg:text-right">
                                {articles.length} {articles.length === 1 ? 'story' : 'stories'}
                            </p>
                        )}
                    </div>
                </header>

                {hasArticles ? (
                    <>
                        <section className="mt-10 grid gap-10 items-start lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-stretch">
                            {renderHeroStory(heroArticle)}
                            {renderHeadlineStack(headlineStack)}
                        </section>

                        <section className="mt-12 grid gap-8 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
                            <div className="space-y-6">
                                {renderTrendingList(trendingStories)}
                            </div>
                            <div className="space-y-12">
                                {renderFeatureGrid(featureGrid)}
                                {renderArchiveList(archiveStories)}
                            </div>
                        </section>
                    </>
                ) : (
                    <p className="mt-16 text-center text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
                        No stories published in this section yet.
                    </p>
                )}
            </main>
        </div>
    );
}

export async function getServerSideProps({ params }) {
    const sectionId = typeof params?.id === 'string' ? params.id.toLowerCase() : '';
    const allArticleData = await getAllArticleData();

    const filteredArticles = Array.isArray(allArticleData)
        ? allArticleData.filter((article) => matchesCategory(article, sectionId))
        : [];

    // keep deterministic order for server-render to avoid hydration mismatch
    const orderedArticles = filteredArticles.sort(sortByPublishedDate);

    const { title, description } = getMetadataForSection(sectionId);

    return {
        props: {
            sectionId,
            sectionName: title,
            sectionDescription: description,
            articles: orderedArticles,
        },
    };
}
