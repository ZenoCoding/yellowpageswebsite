import { getAdmins, getAllArticleData } from '../lib/firebase';
import Link from 'next/link';
import Navbar from '../components/Navbar.js';
import Head from 'next/head';
import { makeCommaSeparatedString } from '../lib/makeCommaSeparatedString';
import { PlusIcon } from '@heroicons/react/20/solid';
import { useUser } from '../firebase/useUser';
import { useRouter } from 'next/router';
import { useEffect, useMemo } from 'react';
import { format as formatDate, isValid as isValidDate, parseISO } from 'date-fns';

const getLandscapeScore = (article) => {
    const width = Number(article?.featuredImage?.width);
    const height = Number(article?.featuredImage?.height);
    if (!Number.isNaN(width) && !Number.isNaN(height) && width > 0 && height > 0) {
        return width / height;
    }
    if (typeof article?.size === 'string') {
        const normalized = article.size.toLowerCase();
        if (normalized.includes('vertical')) {
            return 0.6;
        }
        if (normalized.includes('horizontal') || normalized.includes('landscape')) {
            return 1.6;
        }
        if (normalized.includes('square')) {
            return 1;
        }
    }
    return article?.imageUrl ? 1 : 0;
};

const isLandscapeImage = (article) => getLandscapeScore(article) >= 1;

const prioritizeLandscape = (articles) => {
    if (!Array.isArray(articles)) {
        return [];
    }
    if (articles.length <= 1) {
        return [...articles];
    }
    const result = [...articles];
    let bestIndex = 0;
    let bestScore = getLandscapeScore(result[0]);
    for (let index = 1; index < result.length; index += 1) {
        const score = getLandscapeScore(result[index]);
        if (score > bestScore + 0.05) {
            bestScore = score;
            bestIndex = index;
        }
    }
    if (bestIndex === 0) {
        return result;
    }
    const [bestArticle] = result.splice(bestIndex, 1);
    result.unshift(bestArticle);
    return result;
};

const getSupportingLimitForLead = (leadArticle) => {
    const score = getLandscapeScore(leadArticle);
    if (score >= 1.3) {
        return 5;
    }
    if (score >= 1) {
        return 4;
    }
    return 3;
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

const getLastViewedDate = (article) => parseDateValue(article?.lastViewedAt) || parseDateValue(article?.date);

const InstagramEmbed = () => {
    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const existingScript = document.querySelector('script[src="https://www.instagram.com/embed.js"]');
        if (existingScript) {
            window.instgrm?.Embeds?.process();
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://www.instagram.com/embed.js';
        script.async = true;
        script.onload = () => {
            window.instgrm?.Embeds?.process();
        };
        document.body.appendChild(script);
    }, []);

    return (
        <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
            <blockquote
                className="instagram-media"
                data-instgrm-permalink="https://www.instagram.com/_the_yellow_pages_/?utm_source=ig_embed&utm_campaign=loading"
                data-instgrm-version="14"
                style={{
                    background: '#FFF',
                    border: 0,
                    borderRadius: '3px',
                    boxShadow: '0 0 1px 0 rgba(0,0,0,0.5), 0 1px 10px 0 rgba(0,0,0,0.15)',
                    margin: '1px',
                    maxWidth: '540px',
                    minWidth: '220px',
                    padding: 0,
                    width: '100%',
                }}
            >
                <a
                    href="https://www.instagram.com/_the_yellow_pages_/?utm_source=ig_embed&utm_campaign=loading"
                    target="_blank"
                    rel="noreferrer"
                    className="sr-only"
                >
                    View _the_yellow_pages_ on Instagram
                </a>
            </blockquote>
        </div>
    );
};

export default function Home({ allArticleData, admins }) {
    const { user } = useUser();
    const router = useRouter();
    const admin = user != null && Array.from(admins).includes(user.id);

    const getViewCount = (article) => {
        const value = article?.viewCount;
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
            return value;
        }
        return 0;
    };

    const {
        heroArticle,
        newsRail,
        featureGroup,
        aeGroup,
        opinionGroup,
        sportsGroup,
        hobGroup,
        trendingStories,
    } = useMemo(() => {
        const dataset = Array.isArray(allArticleData) ? allArticleData : [];
        const usedIds = new Set();
        const now = Date.now();

        const matchesCategory = (article, category) => {
            if (!category) return false;
            const normalizedCategory = category.toLowerCase();
            const inputTags = Array.isArray(article.tags)
                ? article.tags
                : typeof article.tags === 'string'
                    ? article.tags.split(',').map((tag) => tag.trim())
                    : [];
            if (inputTags.some((tag) => tag && tag.toLowerCase() === normalizedCategory)) {
                return true;
            }
            if (article.category && typeof article.category === 'string') {
                return article.category.toLowerCase() === normalizedCategory;
            }
            return false;
        };

        const isHumansOfBasis = (article) => {
            if (!article) return false;
            if (matchesCategory(article, 'hob')) {
                return true;
            }
            if (typeof article.category === 'string') {
                return article.category.trim().toLowerCase().includes('humans of basis');
            }
            return false;
        };

        const selectHeroArticle = () => {
            const withImage = (articles) => articles.find((article) => {
                const src = article?.imageUrl;
                return typeof src === 'string' && src.trim().length > 0;
            });

            const newsArticles = dataset.filter((article) => matchesCategory(article, 'news'));

            const heroCandidate =
                withImage(newsArticles) ||
                newsArticles[0] ||
                withImage(dataset) ||
                dataset[0] ||
                null;

            if (heroCandidate) {
                usedIds.add(heroCandidate.id);
                return heroCandidate;
            }

            return null;
        };

        const takeCategoryArticles = (category, desiredCount, { allowFallback = false, exclude } = {}) => {
            const selected = [];
            const primaryPool = dataset.filter((article) => matchesCategory(article, category));
            const shouldExclude = typeof exclude === 'function' ? exclude : () => false;

            for (const article of primaryPool) {
                if (shouldExclude(article)) continue;
                if (usedIds.has(article.id)) continue;
                selected.push(article);
                usedIds.add(article.id);
                if (selected.length === desiredCount) {
                    return selected;
                }
            }

            if (allowFallback) {
                for (const article of dataset) {
                    if (shouldExclude(article)) continue;
                    if (usedIds.has(article.id)) continue;
                    if (selected.some((picked) => picked.id === article.id)) continue;
                    selected.push(article);
                    usedIds.add(article.id);
                    if (selected.length === desiredCount) {
                        break;
                    }
                }
            }

            return selected;
        };

        const hero = selectHeroArticle();
        const sortableArticles = dataset
            .filter((article) => article && typeof article.id === 'string')
            .sort((a, b) => {
                const diff = getViewCount(b) - getViewCount(a);
                if (diff !== 0) {
                    return diff;
                }
                return 0;
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

        const trendingRankings = [...recentArticles, ...fallbackArticles];

        return {
            heroArticle: hero,
            newsRail: takeCategoryArticles('news', 4, { allowFallback: true }),
            featureGroup: prioritizeLandscape(
                takeCategoryArticles('feature', 6, { allowFallback: true, exclude: isHumansOfBasis })
            ),
            aeGroup: prioritizeLandscape(takeCategoryArticles('ae', 6, { allowFallback: true })),
            opinionGroup: takeCategoryArticles('opinion', 4, { allowFallback: true }),
            sportsGroup: prioritizeLandscape(takeCategoryArticles('sports', 6, { allowFallback: true })),
        hobGroup: takeCategoryArticles('hob', 4, { allowFallback: true }),
            trendingStories: trendingRankings.slice(0, 5),
        };
    }, [allArticleData]);

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

    const getImageAltText = (article, fallback) => {
        const altSources = [
            article?.featuredImage?.altText,
            article?.imageAltText,
        ];
        const alt = altSources.find((value) => typeof value === 'string' && value.trim().length > 0);
        return alt || fallback || 'Article image';
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

    const ImageMeta = ({credit, caption, className = '', variant = 'stacked'}) => {
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

    const formatArticleDate = (article) => {
        const dateValue = parseDateValue(article?.date);
        if (!dateValue) {
            return null;
        }
        return formatDate(dateValue, 'MMMM d, yyyy');
    };

    const renderLeadStory = (article) => {
        if (!article) return null;
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
                        Top Story
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

    const renderHeadlineStack = (articles) => {
        if (!articles || articles.length === 0) {
            return (
                <aside className="border-t border-slate-200 pt-6 lg:border-0 lg:pt-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-500">
                        Latest Headlines
                    </p>
                    <p className="mt-4 text-sm text-slate-600">
                        More news coming soon.
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
                    {articles.map((article, index) => {
                        const hasImage = typeof article.imageUrl === 'string' && article.imageUrl.trim().length > 0;
                        const photoCredit = getPhotoCredit(article);
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
                <div className="mt-6">
                    <Link
                        href="/category/news"
                        className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-slate-700 transition-colors duration-200 hover:text-yellow-700"
                    >
                        More stories in News
                        <span aria-hidden="true">→</span>
                    </Link>
                </div>
            </aside>
        );
    };

    const renderTrendingList = (articles) => {
        if (!articles || articles.length === 0) {
            return null;
        }

        const hasViewData = articles.some((article) => getViewCount(article) > 0);

        return (
            <section>
                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-500">
                    Trending Stories
                </p>
                <ol className="mt-4 divide-y divide-slate-200 border-y border-slate-200">
                    {articles.map((article, index) => {
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

    const renderOpinionList = (articles, categorySlug) => {
        const hasArticles = Array.isArray(articles) && articles.length > 0;

        return (
            <section className="space-y-4">
                {renderCategoryHeader('Opinion', categorySlug)}
                {hasArticles ? (
                    <div className="space-y-4">
                        {articles.map((article, index) => {
                            const hasImage =
                                typeof article.imageUrl === 'string' && article.imageUrl.trim().length > 0;
                            const altText = getImageAltText(article, `Thumbnail for ${article.title}`);
                            const publishedOn = formatArticleDate(article);
                            return (
                                <article
                                    key={article.id}
                                    className={`${index === 0 ? '' : 'border-t border-slate-200 pt-4'}`}
                                >
                                    <div
                                        className={`group ${hasImage ? 'grid grid-cols-[90px_minmax(0,1fr)] items-start gap-4' : ''}`}
                                    >
                                        {hasImage && (
                                            <div className="overflow-hidden rounded-sm bg-slate-100">
                                                <img
                                                    src={article.imageUrl}
                                                    alt={altText}
                                                    className="h-24 w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                                                    loading="lazy"
                                                    decoding="async"
                                                />
                                            </div>
                                        )}
                                        <div>
                                            <Link href={`/posts/${article.id}`} className="block">
                                                <h4 className="text-lg font-semibold leading-snug text-slate-900 transition-colors duration-200 hover:text-yellow-700">
                                                    {article.title}
                                                </h4>
                                            </Link>
                                            <p className="mt-2 text-sm font-medium text-slate-600">
                                                {buildByline(article)}
                                                {publishedOn ? ` • ${publishedOn}` : ''}
                                            </p>
                                        </div>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                ) : (
                    <p className="text-sm text-slate-500">
                        More opinion coming soon.
                    </p>
                )}
            </section>
        );
    };

    const renderCategoryHeader = (title) => (
        <header className="border-b border-slate-200 pb-2">
            <h2 className="text-sm font-semibold uppercase tracking-[0.35em] text-slate-600">
                {title}
            </h2>
        </header>
    );

    const renderCategorySection = (title, articles, categorySlug) => {
        const hasArticles = Array.isArray(articles) && articles.length > 0;

        if (!hasArticles) {
            return (
                <section className="space-y-4">
                    {renderCategoryHeader(title)}
                    <p className="text-sm text-slate-500">
                        More {title.toLowerCase()} coming soon.
                    </p>
                    {categorySlug && (
                        <div>
                            <Link
                                href={`/category/${categorySlug}`}
                                className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-slate-700 transition-colors duration-200 hover:text-yellow-700"
                            >
                                More {title}
                                <span aria-hidden="true">→</span>
                            </Link>
                        </div>
                    )}
                </section>
            );
        }

        const [leadArticle, ...rest] = articles;
        const supportingLimit = getSupportingLimitForLead(leadArticle);
        const supportingArticles = rest
            .filter((article) => article?.id !== leadArticle?.id)
            .slice(0, supportingLimit);
        const publishedOnLead = formatArticleDate(leadArticle);
        const photoCreditLead = getPhotoCredit(leadArticle);
        const imageCaptionLead = getImageCaption(leadArticle);
        const altTextLead = getImageAltText(leadArticle, `Cover image for ${leadArticle.title}`);

        return (
            <section className="space-y-4">
                {renderCategoryHeader(title)}
                <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
                    <article className="space-y-4">
                        {leadArticle.imageUrl && (
                            <div className="overflow-hidden rounded-sm bg-slate-100">
                                <div className="aspect-[3/2] overflow-hidden">
                                    <img
                                        src={leadArticle.imageUrl}
                                        alt={altTextLead}
                                        className="h-full w-full object-cover"
                                        loading="lazy"
                                        decoding="async"
                                    />
                                </div>
                            </div>
                        )}
                        <Link href={`/posts/${leadArticle.id}`} className="group block">
                            <h3 className="text-2xl font-bold leading-tight text-slate-900 transition-colors duration-200 group-hover:text-yellow-700">
                                {leadArticle.title}
                            </h3>
                        </Link>
                        {leadArticle.blurb && (
                            <p className="text-sm leading-relaxed text-slate-700">
                                {leadArticle.blurb}
                            </p>
                        )}
                        <p className="text-sm font-medium text-slate-600">
                            {buildByline(leadArticle)}
                            {publishedOnLead ? ` • ${publishedOnLead}` : ''}
                        </p>
                    </article>
                    <aside className="flex h-full flex-col">
                        {supportingArticles.length > 0 ? (
                            <>
                                <div className="flex-1 space-y-5">
                                    {supportingArticles.map((article, index) => {
                                        const publishedOn = formatArticleDate(article);
                                        const hasImage =
                                            typeof article.imageUrl === 'string' && article.imageUrl.trim().length > 0;
                                        const altText = getImageAltText(article, `Thumbnail for ${article.title}`);
                                        return (
                                            <article
                                                key={article.id}
                                                className={`${index === 0 ? '' : 'border-t border-slate-200 pt-4'}`}
                                            >
                                                <div
                                                    className={`group ${hasImage ? 'grid grid-cols-[100px_minmax(0,1fr)] items-start gap-4' : ''}`}
                                                >
                                                    {hasImage && (
                                                        <div>
                                                            <div className="overflow-hidden rounded-sm bg-slate-100">
                                                                <img
                                                                    src={article.imageUrl}
                                                                    alt={altText}
                                                                    className="h-24 w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                                                                    loading="lazy"
                                                                    decoding="async"
                                                                />
                                                            </div>
                                                        </div>
                                                    )}
                                                    <div>
                                                        <Link href={`/posts/${article.id}`} className="block">
                                                            <h4 className="text-lg font-semibold leading-snug text-slate-900 transition-colors duration-200 hover:text-yellow-700">
                                                                {article.title}
                                                            </h4>
                                                        </Link>
                                                        <p className="mt-2 text-sm font-medium text-slate-600">
                                                            {buildByline(article)}
                                                            {publishedOn ? ` • ${publishedOn}` : ''}
                                                        </p>
                                                    </div>
                                                </div>
                                            </article>
                                        );
                                    })}
                                </div>
                                {categorySlug && (
                                    <div className="mt-5 border-t border-slate-200 pt-4">
                                        <Link
                                            href={`/category/${categorySlug}`}
                                            className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-slate-700 transition-colors duration-200 hover:text-yellow-700"
                                        >
                                            More {title}
                                            <span aria-hidden="true">→</span>
                                        </Link>
                                    </div>
                                )}
                            </>
                        ) : (
                            <>
                                <div className="flex-1">
                                    <p className="text-sm text-slate-500">
                                        More {title.toLowerCase()} coming soon.
                                    </p>
                                </div>
                                {categorySlug && (
                                    <div className="mt-4">
                                        <Link
                                            href={`/category/${categorySlug}`}
                                            className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-slate-700 transition-colors duration-200 hover:text-yellow-700"
                                        >
                                            More {title}
                                            <span aria-hidden="true">→</span>
                                        </Link>
                                    </div>
                                )}
                            </>
                        )}
                    </aside>
                </div>
            </section>
        );
    };

    const renderSpotlightSection = (title, articles, categorySlug, { variant = 'default' } = {}) => {
        const hasArticles = Array.isArray(articles) && articles.length > 0;
        const compactArticles = variant === 'compact' ? articles.slice(0, 4) : articles;

        return (
            <section className="mt-16 border-t border-slate-200 pt-10">
                <header className="border-b border-slate-300 pb-2">
                    <h2 className="text-sm font-semibold uppercase tracking-[0.35em] text-slate-600">
                        {title}
                    </h2>
                </header>
                {hasArticles ? (
                    <>
                        {variant === 'compact' ? (
                            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                                {compactArticles.map((article) => {
                                    const publishedOn = formatArticleDate(article);
                                    const altText = getImageAltText(article, `Portrait for ${article.title}`);
                                    return (
                                        <article key={article.id} className="space-y-2">
                                            {article.imageUrl && (
                                                <div className="overflow-hidden rounded-sm bg-slate-100">
                                                    <div className="aspect-[4/5] overflow-hidden">
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
                                                <h3 className="text-lg font-semibold leading-snug text-slate-900 transition-colors duration-200 group-hover:text-yellow-700">
                                                    {article.title}
                                                </h3>
                                            </Link>
                                            <p className="text-sm font-medium text-slate-600">
                                                {buildByline(article)}
                                                {publishedOn ? ` • ${publishedOn}` : ''}
                                            </p>
                                        </article>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="mt-8 grid gap-10 md:grid-cols-2">
                                {articles.map((article) => {
                                    const publishedOn = formatArticleDate(article);
                                    const photoCredit = getPhotoCredit(article);
                                    const imageCaption = getImageCaption(article);
                                    const altText = getImageAltText(article, `Cover image for ${article.title}`);
                                    return (
                                        <article key={article.id} className="space-y-3">
                                            {article.imageUrl && (
                                                <div>
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
                                        </article>
                                    );
                                })}
                            </div>
                        )}
                        {categorySlug && (
                            <div className="mt-8">
                                <Link
                                    href={`/category/${categorySlug}`}
                                    className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-slate-700 transition-colors duration-200 hover:text-yellow-700"
                                >
                                    More {title}
                                    <span aria-hidden="true">→</span>
                                </Link>
                            </div>
                        )}
                    </>
                ) : (
                    <p className="mt-6 text-sm text-slate-500">
                        More {title.toLowerCase()} coming soon.
                    </p>
                )}
            </section>
        );
    };

    return (
        <div className="min-h-screen bg-white">
            <Head>
                <title>Yellow Pages | Student Journalism at BIFU Fremont</title>
                <meta
                    name="description"
                    content="Catch up on the latest news, features, opinions, sports, and Humans of BASIS stories from the Yellow Pages staff at BIFU Fremont."
                />
                <meta property="og:title" content="Yellow Pages | Student Journalism at BIFU Fremont" />
                <meta
                    property="og:description"
                    content="Catch up on the latest news, features, opinions, sports, and Humans of BASIS stories from the Yellow Pages staff at BIFU Fremont."
                />
            </Head>
            <Navbar />
            <main className="mx-auto max-w-[88rem] px-4 pb-12 pt-8 sm:px-6 lg:px-10">
                {heroArticle ? (
                    <section className="border-b border-slate-200 pb-8">
                        <div className="grid gap-10 items-start lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-stretch">
                            {renderLeadStory(heroArticle)}
                            {renderHeadlineStack(newsRail)}
                        </div>
                    </section>
                ) : (
                    <p className="text-center text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
                        No stories published yet.
                    </p>
                )}

                <section className="mt-10 grid gap-8 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
                    <div className="space-y-6">
                        {renderTrendingList(trendingStories)}
                        <InstagramEmbed />
                        {renderOpinionList(opinionGroup, 'opinion')}
                    </div>
                    <div className="space-y-8">
                        {renderCategorySection('Feature', featureGroup, 'feature')}
                        {renderCategorySection('A&E', aeGroup, 'ae')}
                        {renderCategorySection('Sports', sportsGroup, 'sports')}
                    </div>
                </section>

                {renderSpotlightSection('Humans of BASIS', hobGroup, 'hob', { variant: 'compact' })}
            </main>

            {admin && (
                <button
                    className="fixed bottom-10 right-10 rounded-full border-2 border-yellow-300 bg-yellow-400 p-3 text-slate-900 shadow-md transition hover:-translate-y-1 hover:bg-yellow-300 hover:text-black hover:shadow-xl"
                    onClick={() => router.push(`/upload`)}
                    aria-label="Create article"
                    type="button"
                >
                    <PlusIcon className="h-6 w-6 text-slate-900" />
                </button>
            )}
        </div>
    );
}

export async function getServerSideProps() {
    const [allArticleData, adminRecords] = await Promise.all([
        getAllArticleData(),
        getAdmins(),
    ]);
    return {
        props: {
            allArticleData,
            admins: Array.isArray(adminRecords?.admins) ? adminRecords.admins : [],
        },
    };
}
