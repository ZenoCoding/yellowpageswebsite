import { getAdmins, getAllArticleData } from '../lib/firebase';
import Link from 'next/link';
import Navbar from '../components/Navbar.js';
import Head from 'next/head';
import { makeCommaSeparatedString } from '../lib/makeCommaSeparatedString';
import { PlusIcon } from '@heroicons/react/20/solid';
import { useUser } from '../firebase/useUser';
import { useRouter } from 'next/router';
import { useMemo } from 'react';

export default function Home({ allArticleData, admins }) {
    const { user } = useUser();
    const router = useRouter();
    const admin = user != null && Array.from(admins).includes(user.id);

    const {
        heroArticle,
        newsRail,
        featureGroup,
        opinionGroup,
        sportsGroup,
        hobGroup,
    } = useMemo(() => {
        const dataset = Array.isArray(allArticleData) ? allArticleData : [];
        const usedIds = new Set();

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

        const selectHeroArticle = () => {
            const newsLead = dataset.find((article) => matchesCategory(article, 'news'));
            if (newsLead) {
                usedIds.add(newsLead.id);
                return newsLead;
            }
            if (dataset.length > 0) {
                usedIds.add(dataset[0].id);
                return dataset[0];
            }
            return null;
        };

        const takeCategoryArticles = (category, desiredCount, { allowFallback = false } = {}) => {
            const selected = [];
            const primaryPool = dataset.filter((article) => matchesCategory(article, category));

            for (const article of primaryPool) {
                if (usedIds.has(article.id)) continue;
                selected.push(article);
                usedIds.add(article.id);
                if (selected.length === desiredCount) {
                    return selected;
                }
            }

            if (allowFallback) {
                for (const article of dataset) {
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
        return {
            heroArticle: hero,
            newsRail: takeCategoryArticles('news', 4, { allowFallback: true }),
            featureGroup: takeCategoryArticles('feature', 4, { allowFallback: true }),
            opinionGroup: takeCategoryArticles('opinion', 4, { allowFallback: true }),
            sportsGroup: takeCategoryArticles('sports', 4, { allowFallback: true }),
            hobGroup: takeCategoryArticles('hob', 3, { allowFallback: true }),
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

    const renderFeaturedCard = (article, { variant = 'section' } = {}) => {
        if (!article) return null;
        const isHero = variant === 'hero';
        const padding = isHero ? 'p-6 sm:p-8' : 'p-5 sm:p-6';
        const titleClasses = isHero
            ? 'text-3xl sm:text-[2.15rem] font-bold leading-snug text-slate-900'
            : 'text-2xl font-semibold leading-snug text-slate-900';
        const byline = buildByline(article);
        return (
            <Link
                href={`/posts/${article.id}`}
                className="group flex h-full flex-col overflow-hidden rounded-3xl border border-yellow-200 bg-white shadow-md transition hover:-translate-y-1 hover:border-yellow-300 hover:shadow-lg"
            >
                {article.imageUrl && (
                    <div className={isHero ? 'relative aspect-[3/2] bg-yellow-100' : 'relative aspect-[4/3] bg-yellow-100'}>
                        <img
                            src={article.imageUrl}
                            alt={`Cover image for ${article.title}`}
                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                            loading={isHero ? 'eager' : 'lazy'}
                            decoding="async"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-yellow-500/25 via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-70" />
                    </div>
                )}
                <div className={`flex flex-1 flex-col gap-3 ${padding}`}>
                    <h2 className={titleClasses}>{article.title}</h2>
                    {article.blurb && (
                        <p className="text-sm leading-relaxed text-slate-700 sm:text-[0.95rem]">
                            {article.blurb}
                        </p>
                    )}
                    <p className="mt-auto text-xs font-medium text-slate-600">
                        {byline}
                    </p>
                </div>
            </Link>
        );
    };

    const renderSupportingCard = (article) => (
        <Link
            key={article.id}
            href={`/posts/${article.id}`}
            className="group flex rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:border-yellow-300 hover:shadow-lg"
        >
            {article.imageUrl && (
                <div className="relative w-40 flex-shrink-0 overflow-hidden rounded-l-2xl bg-yellow-100 sm:w-44 md:w-48">
                    <img
                        src={article.imageUrl}
                        alt={`Cover image for ${article.title}`}
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                        loading="lazy"
                        decoding="async"
                    />
                </div>
            )}
            <div className={`flex flex-1 flex-col justify-between gap-3 p-4 sm:p-5 ${article.imageUrl ? '' : 'rounded-2xl'}`}>
                <h3 className="text-base font-semibold text-slate-900 transition-colors duration-300 group-hover:text-yellow-700">
                    {article.title}
                </h3>
                <p className="text-[0.75rem] font-medium text-slate-600">
                    {buildByline(article)}
                </p>
            </div>
        </Link>
    );

    const renderSection = (title, articles, alignFeatured = 'left') => {
        if (!articles || articles.length === 0) {
            return null;
        }

        const [featured, ...supporting] = articles;

        if (!featured) {
            return null;
        }

        return (
            <section className="mt-12">
                <div className="flex items-baseline justify-between border-b border-yellow-200 pb-2.5">
                    <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                        {title}
                    </h2>
                    <span className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
                        {supporting.length + 1} stories
                    </span>
                </div>
                <div className="mt-6 grid gap-6 lg:grid-cols-5 lg:items-start">
                    {alignFeatured === 'left' && (
                        <div className="lg:col-span-3">
                            {renderFeaturedCard(featured, { variant: 'section' })}
                        </div>
                    )}
                    <div className="flex flex-col gap-4 lg:col-span-2">
                        {supporting.length > 0
                            ? supporting.map((article) => renderSupportingCard(article))
                            : (
                                <p className="rounded-2xl border border-dashed border-yellow-200 bg-yellow-50/60 p-6 text-sm font-medium uppercase tracking-[0.3em] text-yellow-600">
                                    More {title.toLowerCase()} coming soon
                                </p>
                            )
                        }
                    </div>
                    {alignFeatured === 'right' && (
                        <div className="lg:col-span-3">
                            {renderFeaturedCard(featured, { variant: 'section' })}
                        </div>
                    )}
                </div>
            </section>
        );
    };

    return (
        <div className="min-h-screen bg-white">
            <Head>
                <title>Yellow Pages | Student Journalism at BASIS</title>
                <meta
                    name="description"
                    content="Catch up on the latest news, features, opinions, sports, and Humans of BASIS stories from the Yellow Pages staff."
                />
                <meta property="og:title" content="Yellow Pages | Student Journalism at BASIS" />
                <meta
                    property="og:description"
                    content="Catch up on the latest news, features, opinions, sports, and Humans of BASIS stories from the Yellow Pages staff."
                />
            </Head>
            <Navbar />
            <main className="mx-auto max-w-6xl px-4 pb-12 pt-8 sm:px-6 lg:px-8">
                {heroArticle ? (
                    <section className="grid gap-6 lg:grid-cols-5 lg:items-stretch">
                        <div className="lg:col-span-3">
                            {renderFeaturedCard(heroArticle, { variant: 'hero' })}
                        </div>
                        <div className="flex flex-col gap-4 lg:col-span-2">
                            {newsRail.length > 0
                                ? newsRail.map((article) => renderSupportingCard(article))
                                : (
                                    <p className="rounded-2xl border border-dashed border-yellow-200 bg-yellow-50/60 p-6 text-sm font-medium uppercase tracking-[0.3em] text-yellow-600">
                                        More news coming soon
                                    </p>
                                )
                            }
                        </div>
                        <div className="lg:col-span-5 flex justify-end">
                            <Link
                                href="/category/news"
                                className="inline-flex items-center gap-2 rounded-full border border-yellow-300 bg-yellow-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-yellow-800 transition hover:border-yellow-400 hover:bg-yellow-200"
                            >
                                More stories in News
                                <span aria-hidden="true">→</span>
                            </Link>
                        </div>
                    </section>
                ) : (
                    <p className="text-center text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
                        No stories published yet.
                    </p>
                )}

                {renderSection('Feature', featureGroup, 'left')}
                {renderSection('Opinion', opinionGroup, 'right')}
                {renderSection('Sports', sportsGroup, 'left')}
                {renderSection('Humans of BASIS', hobGroup, 'right')}
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
