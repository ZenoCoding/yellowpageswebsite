import {Fragment} from 'react';
import Link from 'next/link';
import {getAdmins, getArticleContent, getAuthorDirectoryForServer, buildStaffDataForArticle} from '../../lib/firebase';
import Date from '../../components/date';
import {makeCommaSeparatedString} from '../../lib/makeCommaSeparatedString';
import {useRouter} from 'next/router';
import ContentNavbar from "../../components/ContentNavbar";
import {doc, getDoc, getFirestore, increment, serverTimestamp, updateDoc} from "firebase/firestore";
import {getApp} from "firebase/app";
import {PencilIcon} from "@heroicons/react/20/solid";
import {useUser} from "../../firebase/useUser";
import {formatIssueNumber} from '../../lib/newsroom';

const app = getApp()
const db = getFirestore(app)

const toIsoString = (value) => {
    if (!value) {
        return null;
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
    if (typeof value === 'string') {
        return value;
    }
    return null;
};

const buildAuthorLinkLabel = (profile, fallbackName) => {
    if (typeof profile?.fullName === 'string' && profile.fullName.trim().length > 0) {
        return profile.fullName.trim();
    }
    if (typeof fallbackName === 'string' && fallbackName.trim().length > 0) {
        return fallbackName.trim();
    }
    return 'Staff Writer';
};

const interleaveAuthorLinks = (links) => {
    if (links.length <= 1) {
        return links;
    }

    const result = [];
    links.forEach((link, index) => {
        const isLast = index === links.length - 1;

        if (index > 0) {
            if (isLast) {
                result.push(links.length === 2 ? ' and ' : ', and ');
            } else {
                result.push(', ');
            }
        }
        result.push(link);
    });

    return result;
};

export default function Post({articleData, admins, content, issue}) {
    const staffNames = Array.isArray(articleData?.staffNames) && articleData.staffNames.length > 0
        ? articleData.staffNames
        : Array.isArray(articleData?.author)
            ? articleData.author
            : typeof articleData?.author === 'string'
                ? articleData.author.split(',').map((name) => name.trim()).filter((name) => name.length > 0)
                : [];
    const authorData = makeCommaSeparatedString(staffNames, true);
    const staffProfiles = Array.isArray(articleData?.staffProfiles) ? articleData.staffProfiles : [];
    const authorLinks = interleaveAuthorLinks(
        staffProfiles.map((profile, index) => {
            const slugOrId = typeof profile?.authorSlug === 'string' && profile.authorSlug.trim().length > 0
                ? profile.authorSlug.trim()
                : typeof profile?.id === 'string'
                    ? profile.id
                    : '';
            const label = buildAuthorLinkLabel(profile, staffNames[index]);

            if (!slugOrId) {
                return <Fragment key={`author-${index}`}>{label}</Fragment>;
            }

            return (
                <Fragment key={profile.id || profile.authorSlug || index}>
                    <Link href={`/authors/${encodeURIComponent(slugOrId)}`} legacyBehavior>
                        <a className="text-slate-600 transition-colors hover:text-yellow-700 hover:underline">{label}</a>
                    </Link>
                </Fragment>
            );
        })
    );
    const router = useRouter();
    const {user} = useUser();

    const admin = user != null && Array.from(admins).includes(user.id)

    return (
        <div className="flex">
            <div className="m-auto px-5 max-w-2xl my-10">
                <ContentNavbar/>
                <style jsx global>{`
                    a {
                        color: inherit;
                        text-decoration: none;
                    }

                    a:hover {
                        text-decoration: underline;
                    }
                `}</style>
                <div className="flex justify-between">
                    <div>
                        <h1 className="text-4xl mb-1">{articleData.title}</h1>
                        <div className="text-gray-500">
                            <Date dateString={articleData.date}/>
                        </div>
                        <div className="text-gray-500 mb-4">
                            By {authorLinks.length > 0 ? authorLinks : authorData}
                        </div>
                        {issue && <div className="mb-5 text-sm text-slate-500"><Link href={`/issues/${encodeURIComponent(issue.slug)}`} className="font-medium text-slate-600 underline decoration-yellow-400 decoration-2 underline-offset-4 transition hover:text-slate-900">{formatIssueNumber(issue) || 'View issue'}</Link></div>}

                        {(articleData.featuredImage?.url || articleData.imageUrl) && <figure className="mb-8 overflow-hidden rounded-sm bg-slate-100">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={articleData.featuredImage?.url || articleData.imageUrl} alt={articleData.featuredImage?.altText || articleData.title || 'Article image'} className="h-auto w-full object-cover"/>
                            {(articleData.featuredImage?.caption || articleData.featuredImage?.credit) && <figcaption className="px-1 py-3 text-sm leading-5 text-slate-600">
                                {articleData.featuredImage?.caption && <span>{articleData.featuredImage.caption}</span>}
                                {articleData.featuredImage?.credit && <span className="ml-2 text-xs uppercase tracking-wide text-slate-500">{articleData.featuredImage.sourceUrl ? 'Source: ' : 'Photo by '}{articleData.featuredImage.sourceUrl ? <a href={articleData.featuredImage.sourceUrl} target="_blank" rel="noreferrer" className="underline">{articleData.featuredImage.credit}</a> : articleData.featuredImage.credit}</span>}
                            </figcaption>}
                        </figure>}

                        {content?.contentHtml ? (
                            <div dangerouslySetInnerHTML={{__html: content.contentHtml}}/>
                        ) : (
                            <div
                                role="alert"
                                className="my-8 rounded border border-yellow-300 bg-yellow-50 p-5 text-slate-800"
                            >
                                <h2 className="mb-2 text-xl font-semibold">Article temporarily unavailable</h2>
                                <p>
                                    The article text could not be loaded right now. Please check back after the site storage issue is resolved.
                                </p>
                            </div>
                        )}
                        <div className="hover:underline text-blue-500 mb-5 cursor-pointer ">
                            <a onClick={() => router.back()}>← Back</a>
                        </div>
                    </div>
                    {admin && <button
                        className="fixed right-10 top-1/5 bg-white border-2 border-gray-300 rounded-full p-2 hover:shadow-lg cursor-pointer"
                        onClick={() => router.push(`/edit/${router.query.id}`)}
                    >
                        <PencilIcon className="h-5 w-5 text-gray-700"/>
                    </button>}
                </div>
            </div>
        </div>
    )
}

export async function getServerSideProps({params}) {
    const articleRef = doc(db, "articles", params.id);
    const articleSnapshot = await getDoc(articleRef);

    if (!articleSnapshot.exists()) {
        return {
            notFound: true,
        };
    }

    const articleData = articleSnapshot.data();

    try {
        await updateDoc(articleRef, {
            viewCount: increment(1),
            lastViewedAt: serverTimestamp(),
        });
        if (typeof articleData.viewCount === 'number' && Number.isFinite(articleData.viewCount)) {
            articleData.viewCount += 1;
        } else {
            articleData.viewCount = 1;
        }
    } catch (error) {
        console.error('Failed to increment view count for article', params.id, error);
    }

    const serializableArticle = {
        ...articleData,
        date: toIsoString(articleData.date) || articleData.date || null,
        publishedAt: toIsoString(articleData.publishedAt),
        lastViewedAt: toIsoString(articleData.lastViewedAt),
    };

    if (typeof articleData.featuredImageId === 'string' && articleData.featuredImageId) {
        try {
            const imageSnapshot = await getDoc(doc(db, 'images', articleData.featuredImageId));
            if (imageSnapshot.exists()) {
                const image = imageSnapshot.data() || {};
                serializableArticle.featuredImage = {
                    id: imageSnapshot.id,
                    url: typeof image.url === 'string' ? image.url : null,
                    caption: typeof image.caption === 'string' ? image.caption : '',
                    credit: typeof image.credit === 'string' ? image.credit : '',
                    altText: typeof image.altText === 'string' ? image.altText : '',
                    sourceUrl: typeof image.sourceUrl === 'string' ? image.sourceUrl : null,
                };
            }
        } catch (error) {
            console.error('Failed to load featured image for article', params.id, error);
        }
    }

    let issue = null;
    if (typeof articleData.issueId === 'string' && articleData.issueId) {
        try {
            const issueSnapshot = await getDoc(doc(db, 'issues', articleData.issueId));
            if (issueSnapshot.exists()) {
                const issueData = issueSnapshot.data() || {};
                const issueIsPublic = issueData.status === 'published' || (issueData.status === 'archived' && issueData.publishedAt);
                if (issueIsPublic && typeof issueData.slug === 'string' && issueData.slug) {
                    issue = {
                        id: issueSnapshot.id,
                        name: typeof issueData.name === 'string' ? issueData.name : 'Untitled issue',
                        slug: issueData.slug,
                        schoolYear: typeof issueData.schoolYear === 'string' ? issueData.schoolYear : '',
                        volumeNumber: Number.isInteger(issueData.volumeNumber) ? issueData.volumeNumber : null,
                        issueNumber: Number.isInteger(issueData.issueNumber) ? issueData.issueNumber : null,
                    };
                }
            }
        } catch (error) {
            console.error('Failed to load issue for article', params.id, error);
        }
    }

    const authorDirectory = await getAuthorDirectoryForServer();
    const staffData = buildStaffDataForArticle(articleData, authorDirectory);
    let content;
    try {
        content = await getArticleContent(params.id)
    } catch (error) {
        console.error('Failed to load article content for article', params.id, error);
        content = {
            id: params.id,
            contentHtml: '',
            markdown: '',
            referencedImages: [],
            loadError: true,
        };
    }

    return {
        props: {
            articleData: {
                ...serializableArticle,
                author: staffData.staffNames,
                staffNames: staffData.staffNames,
                staffProfiles: staffData.staffProfiles,
                authorIds: staffData.authorIds,
            },
            admins: (await getAdmins()).admins,
            content,
            issue,
        }
    }
}
