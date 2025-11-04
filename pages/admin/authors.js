import {useCallback, useEffect, useMemo, useState} from 'react';
import {getApp} from 'firebase/app';
import {
    arrayUnion,
    collection,
    doc,
    getDoc,
    getDocs,
    getFirestore,
    serverTimestamp,
    updateDoc,
} from 'firebase/firestore';
import {useUser} from '../../firebase/useUser';
import NoAuth from '../../components/auth/NoAuth';
import ContentNavbar from '../../components/ContentNavbar';
import {createAuthor, deleteAuthor, updateAuthor} from '../../lib/authors';
import {useAuthors} from '../../hooks/useAuthors';
import {getAdmins} from '../../lib/firebase';

const POSITION_OPTIONS = [
    'Editor-in-Chief',
    'Managing Editor',
    'News Editor',
    'Feature Editor',
    'Sports Editor',
    'Opinion Editor',
    'A&E Editor',
    'Copy Editor',
    'Photo Editor',
    'Multimedia Editor',
    'Staff Writer',
    'Guest Contributor',
];

const GENERIC_TAGS = new Set(
    [
        'news',
        'feature',
        'opinion',
        'sports',
        'hob',
        'creative',
        'student life',
        'events',
        'local',
        'ae',
        'review',
        'analysis',
        'podcast',
        'video',
        'multimedia',
        'photography',
        'announcement',
        'editorial board',
        'staff writer',
        'guest contributor',
        'eic',
        'copy editor',
        'news editor',
        'feature editor',
        'sports editor',
        'creative editor',
        'opinion editor',
        'managing editor',
        'editor-in-chief',
        'staff',
        'students',
    ].map((token) => token.toLowerCase())
);

const COMPOSITE_CONNECTOR_DETECTOR =
    /(?:\s+(?:and|with)\s+|\s*&\s*|\s*\/\s*|\s*\+\s*|;|\s*\|\s*)/i;
const COMPOSITE_CONNECTOR_SPLIT =
    /\s+(?:and|with)\s+|\s*&\s*|\s*\/\s*|\s*\+\s*|;|\s*\|\s*/i;

const splitCompositeNames = (input) => {
    if (typeof input !== 'string') {
        return [];
    }
    const trimmed = input.trim();
    if (!trimmed) {
        return [];
    }
    if (!COMPOSITE_CONNECTOR_DETECTOR.test(trimmed)) {
        return [trimmed];
    }
    return trimmed
        .split(COMPOSITE_CONNECTOR_SPLIT)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
};

const sanitizeNameToken = (input) => {
    if (typeof input !== 'string') {
        return '';
    }
    let value = input.trim();
    if (!value) {
        return '';
    }
    value = value.replace(/^(?:and|with|by)\s+/i, '').trim();
    if (!value || /^and$/i.test(value)) {
        return '';
    }
    value = value.replace(/[.,;:!?]+$/g, '').trim();
    return value;
};

const deriveNameKeys = (input) => {
    if (typeof input !== 'string') {
        return [];
    }
    const trimmed = input.trim();
    if (!trimmed) {
        return [];
    }
    const normalized = trimmed.replace(/\s+/g, ' ');
    const variants = new Set();
    const lower = normalized.toLowerCase();
    variants.add(lower);

    const stripped = lower.replace(/[.,;:!?]+$/, '').trim();
    if (stripped && stripped !== lower) {
        variants.add(stripped);
    }

    return Array.from(variants);
};

const computeInitials = (name) => {
    if (typeof name !== 'string') {
        return '';
    }
    const tokens = name
        .trim()
        .split(/\s+/)
        .filter((token) => token.length > 0)
        .map((token) => token[0]?.toUpperCase() ?? '');
    const joined = tokens.join('');
    return joined.slice(0, 2) || '';
};

const INITIAL_FORM_STATE = {
    id: null,
    fullName: '',
    photoUrl: '',
    graduationYear: '',
    position: '',
    bio: '',
    isHidden: false,
    hasDeparted: false,
};

const now = new Date();

const normalizeCandidate = (input) => {
    if (typeof input !== 'string') return null;
    let trimmed = input.trim();
    if (!trimmed) return null;
    trimmed = trimmed.replace(/\s+/g, ' ');
    trimmed = trimmed.replace(/[.,;:!?]+$/, '').trim();
    if (!trimmed) return null;
    trimmed = trimmed.replace(/^by\s+/i, '').trim();
    if (!trimmed) return null;
    if (trimmed.length < 3) return null;
    if (/https?:\/\//i.test(trimmed)) return null;
    if (/[,#@]/.test(trimmed)) return null;
    const lower = trimmed.toLowerCase();
    if (GENERIC_TAGS.has(lower)) return null;
    const hasSpace = /\s/.test(trimmed);
    if (!hasSpace && trimmed === lower) {
        return null;
    }
    return {
        key: lower,
        name: trimmed,
    };
};

const parseAuthorField = (value) => {
    const results = [];
    const pushEntry = (entry) => {
        splitCompositeNames(entry).forEach((part) => {
            const cleaned = sanitizeNameToken(part);
            if (cleaned.length > 0) {
                results.push(cleaned);
            }
        });
    };

    if (Array.isArray(value)) {
        value.forEach((entry) => {
            if (typeof entry === 'string') {
                entry
                    .split(',')
                    .map((token) => token.trim())
                    .filter((token) => token.length > 0)
                    .forEach(pushEntry);
            }
        });
        return results;
    }
    if (typeof value === 'string') {
        value
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
            .forEach(pushEntry);
        return results;
    }
    return results;
};

const computeStaffStatus = (author) => {
    if (!author) {
        return {label: 'Unknown', tone: 'bg-slate-200 text-slate-700'};
    }
    if (author.hasDeparted) {
        return {label: 'Departed', tone: 'bg-rose-100 text-rose-700'};
    }
    const {graduationYear} = author;
    if (!graduationYear) {
        return {label: 'Active', tone: 'bg-emerald-100 text-emerald-700'};
    }
    const nowLocal = new Date();
    const juneCutoff = new Date(graduationYear, 5, 30, 23, 59, 59);
    if (nowLocal <= juneCutoff) {
        return {label: 'Active', tone: 'bg-emerald-100 text-emerald-700'};
    }
    return {label: 'Alumni', tone: 'bg-slate-200 text-slate-700'};
};

const promoteNameSort = (a, b) => a.name.localeCompare(b.name);

export default function AuthorAdminPage({admins}) {
    const {user} = useUser();
    const adminIds = useMemo(() => Array.from(admins), [admins]);
    const isAdmin = Boolean(user && adminIds.includes(user.id));
    const {authors, loading: authorsLoading, error: authorsError} = useAuthors({enabled: isAdmin});
    const [formState, setFormState] = useState(() => ({...INITIAL_FORM_STATE}));
    const [formMode, setFormMode] = useState('create');
    const [isSaving, setIsSaving] = useState(false);
    const [formMessage, setFormMessage] = useState(null);
    const [formError, setFormError] = useState(null);

    const [candidates, setCandidates] = useState([]);
    const [candidateContext, setCandidateContext] = useState(null);
    const [candidateLoading, setCandidateLoading] = useState(false);
    const [candidateError, setCandidateError] = useState(null);
    const [activeAuthorSnapshot, setActiveAuthorSnapshot] = useState(null);
    const [showOnlyActive, setShowOnlyActive] = useState(false);

    const authorLookup = useMemo(() => {
        const map = new Map();
        authors.forEach((author) => {
            deriveNameKeys(author.fullName).forEach((key) => {
                if (key && !map.has(key)) {
                    map.set(key, author);
                }
            });
        });
        return map;
    }, [authors]);

    const resetForm = () => {
        setFormState({...INITIAL_FORM_STATE});
        setFormMode('create');
        setCandidateContext(null);
        setActiveAuthorSnapshot(null);
    };

    const loadCandidates = useCallback(async () => {
        if (!isAdmin) {
            setCandidateLoading(false);
            setCandidateError(null);
            setCandidates([]);
            return;
        }

        setCandidateLoading(true);
        setCandidateError(null);
        try {
            const db = getFirestore(getApp());
            const snapshot = await getDocs(collection(db, 'articles'));
            const map = new Map();

            snapshot.forEach((articleDoc) => {
                const articleId = articleDoc.id;
                const data = articleDoc.data();
                const tags = Array.isArray(data?.tags)
                    ? data.tags
                    : typeof data?.tags === 'string'
                        ? data.tags.split(',').map((tag) => tag.trim())
                        : [];
                const authorTokens = parseAuthorField(data?.author);
                const linkedAuthorIds = Array.isArray(data?.authorIds)
                    ? data.authorIds.filter((value) => typeof value === 'string')
                    : [];
                const allTokens = [...tags, ...authorTokens];
                const articleSeen = new Set();

                allTokens.forEach((token) => {
                    splitCompositeNames(token).forEach((part) => {
                        const candidate = normalizeCandidate(part);
                        if (!candidate) {
                            return;
                        }
                        if (articleSeen.has(candidate.key)) {
                            return;
                        }
                        articleSeen.add(candidate.key);

                        const matchedAuthor = authorLookup.get(candidate.key);
                        if (matchedAuthor && linkedAuthorIds.includes(matchedAuthor.id)) {
                            return;
                        }

                        if (!map.has(candidate.key)) {
                            map.set(candidate.key, {
                                key: candidate.key,
                                name: candidate.name,
                                articleIds: new Set(),
                                samples: new Set(),
                                existingAuthor: matchedAuthor || null,
                            });
                        }
                        const record = map.get(candidate.key);
                        if (matchedAuthor && !record.existingAuthor) {
                            record.existingAuthor = matchedAuthor;
                        }
                        record.articleIds.add(articleId);
                        record.samples.add(candidate.name);
                    });
                });
            });

            const nextCandidates = Array.from(map.values())
                .map((entry) => ({
                    key: entry.key,
                    name: entry.name,
                    articleIds: Array.from(entry.articleIds),
                    count: entry.articleIds.size,
                    samples: Array.from(entry.samples).slice(0, 3),
                    existingAuthorId: entry.existingAuthor ? entry.existingAuthor.id : null,
                    existingAuthorName: entry.existingAuthor ? entry.existingAuthor.fullName : null,
                }))
                .sort((a, b) => {
                    if (!!a.existingAuthorId !== !!b.existingAuthorId) {
                        return a.existingAuthorId ? 1 : -1;
                    }
                    if (b.count !== a.count) {
                        return b.count - a.count;
                    }
                    return promoteNameSort(a, b);
                });

            setCandidates(nextCandidates);
        } catch (error) {
            setCandidateError(error instanceof Error ? error : new Error('Unable to load candidates.'));
        } finally {
            setCandidateLoading(false);
        }
    }, [authorLookup, isAdmin]);

    useEffect(() => {
        if (!isAdmin || authorsLoading) {
            return;
        }
        loadCandidates();
    }, [authorsLoading, isAdmin, loadCandidates]);

    const handleEditAuthor = (author) => {
        setFormState({
            id: author.id,
            fullName: author.fullName || '',
            photoUrl: author.photoUrl || '',
            graduationYear: author.graduationYear || '',
            position: author.position || '',
            bio: author.bio || '',
            isHidden: Boolean(author.isHidden),
            hasDeparted: Boolean(author.hasDeparted),
        });
        setFormMode('edit');
        setCandidateContext(null);
        setFormMessage(null);
        setFormError(null);
        setActiveAuthorSnapshot(author);
    };

    const handlePromoteCandidate = (candidate) => {
        setFormState({
            ...INITIAL_FORM_STATE,
            fullName: candidate.name,
        });
        setFormMode('create');
        setCandidateContext(candidate);
        setFormMessage(`Creating staff profile for "${candidate.name}" (${candidate.count} articles)`);
        setFormError(null);
        setActiveAuthorSnapshot(null);
    };

    const handleLinkExistingCandidate = async (candidate) => {
        const existingAuthor = authorLookup.get(candidate.key);
        if (!existingAuthor) {
            setFormError('Unable to find a matching staff profile.');
            return;
        }
        setFormError(null);
        setFormMessage(null);
        try {
            await linkAuthorToArticles(existingAuthor.id, existingAuthor.fullName, candidate.articleIds);
            setFormMessage(
                `Linked ${existingAuthor.fullName} to ${candidate.count} article${candidate.count === 1 ? '' : 's'}.`
            );
            await loadCandidates();
        } catch (error) {
            setFormError(error instanceof Error ? error.message : 'Failed to link existing staff member.');
        }
    };

    const handleDeleteAuthor = async (authorId, authorName) => {
        const confirmed = window.confirm(`Remove ${authorName}? They will stay attached to existing articles until those entries are updated manually.`);
        if (!confirmed) {
            return;
        }
        setFormMessage(null);
        setFormError(null);
        try {
            await deleteAuthor(authorId);
            setFormMessage(`${authorName} removed from the staff directory.`);
        } catch (error) {
            setFormError(error instanceof Error ? error.message : 'Unable to delete staff member.');
        }
    };

    const linkAuthorToArticles = useCallback(async (authorId, authorName, articleIds) => {
        if (!Array.isArray(articleIds) || articleIds.length === 0) {
            return;
        }

        const db = getFirestore(getApp());
        const updatedArticleIds = [];

        for (const articleId of articleIds) {
            try {
                const articleRef = doc(db, 'articles', articleId);
                const articleSnap = await getDoc(articleRef);
                if (!articleSnap.exists()) {
                    continue;
                }
                const articleData = articleSnap.data();
                const existingAuthorNames = parseAuthorField(articleData?.author);
                const existingIds = Array.isArray(articleData?.authorIds)
                    ? articleData.authorIds.filter((value) => typeof value === 'string')
                    : [];

                const normalizedNames = existingAuthorNames.map((name) => name.trim());
                const alreadyHasName = normalizedNames.some(
                    (name) => name.toLowerCase() === authorName.trim().toLowerCase()
                );

                const nextNames = alreadyHasName
                    ? normalizedNames
                    : [...normalizedNames, authorName.trim()];

                const hasId = existingIds.includes(authorId);
                const nextIds = hasId ? existingIds : [...existingIds, authorId];

                await updateDoc(articleRef, {
                    author: nextNames,
                    authorIds: nextIds,
                });
                updatedArticleIds.push(articleId);
            } catch (error) {
                console.error('Failed to link staff member to article', articleId, error);
            }
        }

        if (updatedArticleIds.length > 0) {
            await updateDoc(doc(db, 'authors', authorId), {
                linkedArticleIds: arrayUnion(...updatedArticleIds),
                lastUsedAt: serverTimestamp(),
            });
        }
    }, []);

    const renameAuthorAcrossArticles = useCallback(
        async ({authorId, newName, oldName, articleIds}) => {
            const trimmedNewName = typeof newName === 'string' ? newName.trim() : '';
            if (!authorId || !trimmedNewName) {
                return;
            }

            const normalizedNewName = trimmedNewName.toLowerCase();
            const normalizedOldName = typeof oldName === 'string' ? oldName.trim().toLowerCase() : null;

            const db = getFirestore(getApp());
            let targetArticleIds = Array.isArray(articleIds)
                ? articleIds.filter((value) => typeof value === 'string' && value.trim().length > 0)
                : [];

            if (targetArticleIds.length === 0) {
                try {
                    const authorSnap = await getDoc(doc(db, 'authors', authorId));
                    if (authorSnap.exists()) {
                        const linkedIds = authorSnap.data()?.linkedArticleIds;
                        if (Array.isArray(linkedIds)) {
                            targetArticleIds = linkedIds.filter(
                                (value) => typeof value === 'string' && value.trim().length > 0
                            );
                        }
                    }
                } catch (error) {
                    console.error('Failed to load staff record for rename propagation', error);
                }
            }

            if (targetArticleIds.length === 0) {
                return;
            }

            const updatedArticleIds = [];

            for (const articleId of targetArticleIds) {
                try {
                    const articleRef = doc(db, 'articles', articleId);
                    const articleSnap = await getDoc(articleRef);
                    if (!articleSnap.exists()) {
                        continue;
                    }

                    const articleData = articleSnap.data();
                    let authorNames = parseAuthorField(articleData?.author);
                    const authorIdList = Array.isArray(articleData?.authorIds)
                        ? articleData.authorIds.filter((value) => typeof value === 'string')
                        : [];

                    let changed = false;

                    if (normalizedOldName) {
                        const filtered = authorNames.filter(
                            (name) => name.trim().toLowerCase() !== normalizedOldName
                        );
                        if (filtered.length !== authorNames.length) {
                            authorNames = filtered;
                            changed = true;
                        }
                    }

                    if (!authorNames.some((name) => name.trim().toLowerCase() === normalizedNewName)) {
                        authorNames.push(trimmedNewName);
                        changed = true;
                    }

                    if (!authorIdList.includes(authorId)) {
                        authorIdList.push(authorId);
                        changed = true;
                    }

                    const dedupedIds = Array.from(new Set(authorIdList));
                    if (dedupedIds.length !== authorIdList.length) {
                        changed = true;
                    }

                    const dedupedNames = Array.from(
                        new Set(
                            authorNames
                                .map((name) => name.trim())
                                .filter((name) => name.length > 0)
                        )
                    );

                    if (dedupedNames.length === 0) {
                        dedupedNames.push(trimmedNewName);
                    }

                    if (dedupedNames.length !== authorNames.length) {
                        changed = true;
                    }

                    if (!changed) {
                        continue;
                    }

                    await updateDoc(articleRef, {
                        author: dedupedNames,
                        authorIds: dedupedIds,
                    });
                    updatedArticleIds.push(articleId);
                } catch (error) {
                    console.error('Failed to propagate staff rename to article', articleId, error);
                }
            }

            if (updatedArticleIds.length > 0) {
                await updateDoc(doc(db, 'authors', authorId), {
                    lastUsedAt: serverTimestamp(),
                });
            }
        },
        []
    );

    const handleSubmit = async (event) => {
        event.preventDefault();
        setFormError(null);
        setFormMessage(null);

        const trimmedName = formState.fullName.trim();
        const trimmedPhoto = formState.photoUrl.trim();
        const trimmedPosition = formState.position.trim();
        const trimmedBio = formState.bio.trim();
        const numericGraduationYear = formState.graduationYear
            ? Number(formState.graduationYear)
            : undefined;

        if (!trimmedName) {
        setFormError('Staff name is required.');
            return;
        }
        if (!trimmedPosition) {
            setFormError('Select a staff position.');
            return;
        }
        if (!numericGraduationYear || Number.isNaN(numericGraduationYear)) {
            setFormError('Enter a valid graduation year.');
            return;
        }

        const payload = {
            fullName: trimmedName,
            position: trimmedPosition,
            graduationYear: numericGraduationYear,
            bio: trimmedBio || null,
            isHidden: Boolean(formState.isHidden),
            hasDeparted: Boolean(formState.hasDeparted),
            photoUrl: trimmedPhoto ? trimmedPhoto : null,
        };

        setIsSaving(true);
        try {
            if (formMode === 'edit' && formState.id) {
                await updateAuthor(formState.id, payload);
                const previousName = activeAuthorSnapshot?.fullName;
                if (previousName && previousName.trim().toLowerCase() !== trimmedName.toLowerCase()) {
                    await renameAuthorAcrossArticles({
                        authorId: formState.id,
                        newName: trimmedName,
                        oldName: previousName,
                        articleIds: activeAuthorSnapshot?.linkedArticleIds,
                    });
                }
                setFormMessage(`${trimmedName} profile updated.`);
            } else {
                const docRef = await createAuthor({
                    ...payload,
                    linkedArticleIds: candidateContext?.articleIds ?? [],
                    lastUsedAt: candidateContext ? serverTimestamp() : undefined,
                });
                setFormMessage(`${trimmedName} added to the staff directory.`);
                if (candidateContext) {
                    await linkAuthorToArticles(docRef.id, trimmedName, candidateContext.articleIds);
                    setCandidateContext(null);
                    await loadCandidates();
                }
            }
            resetForm();
        } catch (error) {
            setFormError(error instanceof Error ? error.message : 'Unable to save staff profile.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleRefreshCandidates = async () => {
        await loadCandidates();
        setFormMessage('Candidate list refreshed.');
    };

    const renderStaff = () => {
        if (authorsLoading) {
            return <p className="text-sm text-gray-500">Loading staff…</p>;
        }
        if (authorsError) {
            return <p className="text-sm text-red-500">Unable to load staff directory: {authorsError.message}</p>;
        }
        if (authors.length === 0) {
            return <p className="text-sm text-gray-500">No staff members yet.</p>;
        }

        const entries = authors.map((author) => {
            const status = computeStaffStatus(author);
            const initials = computeInitials(author.fullName) || '??';
            return {author, status, initials};
        });

        const filteredEntries = showOnlyActive
            ? entries.filter((entry) => entry.status.label === 'Active')
            : entries;

        if (filteredEntries.length === 0) {
            return (
                <p className="text-sm text-slate-500">
                    {showOnlyActive ? 'No active staff yet.' : 'No staff members yet.'}
                </p>
            );
        }

        return (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {filteredEntries.map(({author, status, initials}) => (
                    <li
                        key={author.id}
                        className="group flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-indigo-200 hover:shadow-lg"
                    >
                        <div className="flex items-start gap-2.5">
                            {author.photoUrl ? (
                                <img
                                    src={author.photoUrl}
                                    alt={author.fullName}
                                    className="h-16 w-16 flex-none rounded-xl object-cover shadow-sm ring-1 ring-slate-200 transition group-hover:ring-indigo-200"
                                />
                            ) : (
                                <span className="flex h-16 w-16 flex-none items-center justify-center rounded-xl bg-gradient-to-br from-indigo-100 via-indigo-50 to-white text-base font-semibold text-indigo-600 shadow-inner ring-1 ring-indigo-100">
                                    {initials}
                                </span>
                            )}
                            <div className="min-w-0 flex-1 space-y-1.5">
                                <div className="min-w-0">
                                    <h3 className="truncate text-base font-semibold text-slate-900">{author.fullName}</h3>
                                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                        <span className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600">
                                            {author.position || 'Staff'}
                                        </span>
                                        <span
                                            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.tone}`}
                                        >
                                            {status.label}
                                        </span>
                                    </div>
                                </div>
                                {author.bio ? (
                                    <p className="mt-3 max-h-16 overflow-hidden text-sm leading-relaxed text-slate-600">
                                        {author.bio}
                                    </p>
                                ) : null}
                            </div>
                        </div>
                        <dl className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600">
                            {author.graduationYear ? (
                                <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1">
                                    <dt className="sr-only">Graduation</dt>
                                    <dd className="font-medium text-slate-700">Class of {author.graduationYear}</dd>
                                </div>
                            ) : null}
                            {Array.isArray(author.linkedArticleIds) && author.linkedArticleIds.length > 0 ? (
                                <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1">
                                    <dt className="sr-only">Articles</dt>
                                    <dd className="font-medium text-slate-700">
                                        {author.linkedArticleIds.length} linked article
                                        {author.linkedArticleIds.length === 1 ? '' : 's'}
                                    </dd>
                                </div>
                            ) : null}
                        </dl>
                        <div className="mt-3 flex flex-wrap gap-2">
                            <button
                                type="button"
                                className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-3.5 py-1 text-[11px] font-semibold text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:ring-offset-2"
                                onClick={() => handleEditAuthor(author)}
                            >
                                Edit details
                            </button>
                            <button
                                type="button"
                                className="inline-flex items-center rounded-full border border-transparent bg-rose-50 px-4 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-200 focus:ring-offset-2"
                                onClick={() => handleDeleteAuthor(author.id, author.fullName)}
                            >
                                Remove
                            </button>
                        </div>
                    </li>
                ))}
            </ul>
        );
    };

    if (!user) {
        return <NoAuth/>;
    }
    if (!isAdmin) {
        return <NoAuth permission={true}/>;
    }

    return (
        <div className="m-auto my-10 max-w-6xl px-5">
            <ContentNavbar/>
            <h1 className="mt-6 text-3xl font-bold">Staff Management</h1>
            <p className="mt-2 text-sm text-slate-600">
                Maintain a canonical staff list so uploaders can pick from verified contributors. Profiles automatically
                move to alumni after June 30 of their graduation year—use the departed toggle when someone leaves early.
            </p>

            <div className="mt-8 grid gap-8 lg:grid-cols-3">
                <section className="lg:col-span-2 space-y-6">
                    <div>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <h2 className="text-xl font-semibold text-slate-800">Active Staff</h2>
                            <label className="flex items-center gap-2 text-sm text-slate-600">
                                <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                    checked={showOnlyActive}
                                    onChange={(event) => setShowOnlyActive(event.target.checked)}
                                />
                                Show only active staff
                            </label>
                        </div>
                        <div className="mt-4">{renderStaff()}</div>
                    </div>

                    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h3 className="text-base font-semibold text-slate-800">Backfill from existing articles</h3>
                                <p className="mt-1 text-xs text-slate-600">
                                    We scan article tags and bylines for proper names.
                                    Promote a candidate to pre-fill the form and auto-link the matching articles.
                                </p>
                            </div>
                            <button
                                type="button"
                                className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                                onClick={handleRefreshCandidates}
                                disabled={candidateLoading}
                            >
                                Refresh
                            </button>
                        </div>

                        {candidateError ? (
                            <p className="mt-3 text-xs text-rose-600">
                                Unable to load candidates: {candidateError.message}
                            </p>
                        ) : null}

                        <div className="mt-3 max-h-72 overflow-y-auto rounded-md border border-slate-200 bg-white">
                            {candidateLoading ? (
                                <div className="p-3 text-xs text-slate-500">Scanning articles…</div>
                            ) : candidates.length === 0 ? (
                                <div className="p-3 text-xs text-slate-500">
                                    No unlinked staff names detected in article metadata.
                                </div>
                            ) : (
                                <ul className="divide-y divide-slate-100">
                                    {candidates.map((candidate) => (
                                        <li key={candidate.key} className="flex items-center justify-between gap-3 px-3 py-2">
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-medium text-slate-800">{candidate.name}</p>
                                                <p className="text-xs text-slate-500">
                                                    {candidate.count} article{candidate.count === 1 ? '' : 's'}
                                                    {candidate.samples.length > 0 ? ` • sample tag: ${candidate.samples[0]}` : ''}
                                                </p>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-2">
                                                {candidate.existingAuthorId ? (
                                                    <>
                                                        <button
                                                            type="button"
                                                            className="rounded-md bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-200"
                                                            onClick={() => handleLinkExistingCandidate(candidate)}
                                                        >
                                                            Link Profile
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="rounded-md border border-indigo-200 px-3 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
                                                            onClick={() => handlePromoteCandidate(candidate)}
                                                        >
                                                            Create Profile
                                                        </button>
                                                    </>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700"
                                                        onClick={() => handlePromoteCandidate(candidate)}
                                                    >
                                                        Create Profile
                                                    </button>
                                                )}
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                </section>

                <section className="lg:col-span-1">
                    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                        <h2 className="text-lg font-semibold text-slate-800">
                            {formMode === 'edit' ? 'Edit Staff Profile' : 'Add Staff Member'}
                        </h2>
                        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
                            <div>
                                <label htmlFor="fullName" className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                                    Staff Name
                                </label>
                                <input
                                    id="fullName"
                                    type="text"
                                    value={formState.fullName}
                                    onChange={(event) =>
                                        setFormState((previous) => ({...previous, fullName: event.target.value}))
                                    }
                                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                                    placeholder="Jane Reporter"
                                    required
                                />
                            </div>

                            <div>
                                <label htmlFor="photoUrl" className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                                    Profile Image URL <span className="normal-case text-slate-400">(optional)</span>
                                </label>
                                <input
                                    id="photoUrl"
                                    type="url"
                                    value={formState.photoUrl}
                                    onChange={(event) =>
                                        setFormState((previous) => ({...previous, photoUrl: event.target.value}))
                                    }
                                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                                    placeholder="https://…"
                                />
                            </div>

                            <div>
                                <label htmlFor="position" className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                                    Position
                                </label>
                                <select
                                    id="position"
                                    value={formState.position}
                                    onChange={(event) =>
                                        setFormState((previous) => ({...previous, position: event.target.value}))
                                    }
                                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                                    required
                                >
                                    <option value="">Select position</option>
                                    {POSITION_OPTIONS.map((option) => (
                                        <option key={option} value={option}>
                                            {option}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label htmlFor="graduationYear" className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                                    Graduation Year
                                </label>
                                <input
                                    id="graduationYear"
                                    type="number"
                                    min="2000"
                                    max="2100"
                                    value={formState.graduationYear}
                                    onChange={(event) =>
                                        setFormState((previous) => ({...previous, graduationYear: event.target.value}))
                                    }
                                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                                    placeholder={String(now.getFullYear())}
                                    required
                                />
                            </div>

                            <div>
                                <label htmlFor="bio" className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                                    Short Bio (optional)
                                </label>
                                <textarea
                                    id="bio"
                                    value={formState.bio}
                                    onChange={(event) =>
                                        setFormState((previous) => ({...previous, bio: event.target.value}))
                                    }
                                    rows={3}
                                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                                    placeholder="Optional background or roles."
                                />
                            </div>

                            <div className="flex items-center gap-2">
                                <input
                                    id="hasDeparted"
                                    type="checkbox"
                                    checked={formState.hasDeparted}
                                    onChange={(event) =>
                                        setFormState((previous) => ({...previous, hasDeparted: event.target.checked}))
                                    }
                                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                <label htmlFor="hasDeparted" className="text-xs text-slate-600">
                                    Mark as departed (left the paper early)
                                </label>
                            </div>

                            <div className="flex items-center gap-2">
                                <input
                                    id="isHidden"
                                    type="checkbox"
                                    checked={formState.isHidden}
                                    onChange={(event) =>
                                        setFormState((previous) => ({...previous, isHidden: event.target.checked}))
                                    }
                                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                <label htmlFor="isHidden" className="text-xs text-slate-600">
                                    Hide from selection lists (keeps data for archives)
                                </label>
                            </div>

                            <div className="flex items-center gap-3 pt-2">
                                <button
                                    type="submit"
                                    className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                                    disabled={isSaving}
                                >
                                    {isSaving ? 'Saving…' : formMode === 'edit' ? 'Save Changes' : 'Add Staff Member'}
                                </button>
                                <button
                                    type="button"
                                    className="text-sm text-slate-500 hover:text-slate-700"
                                    onClick={resetForm}
                                >
                                    Reset
                                </button>
                            </div>
                        </form>

                        {formError ? <p className="mt-3 text-sm text-rose-600">{formError}</p> : null}
                        {formMessage ? <p className="mt-3 text-sm text-emerald-600">{formMessage}</p> : null}
                        {candidateContext ? (
                            <p className="mt-3 text-xs text-slate-500">
                                Promoted from article metadata. Saving will link {candidateContext.count} article
                                {candidateContext.count === 1 ? '' : 's'} to this staff member.
                            </p>
                        ) : null}
                    </div>
                </section>
            </div>
        </div>
    );
}

export async function getServerSideProps() {
    const admins = await getAdmins();

    return {
        props: {
            admins: admins.admins,
        },
    };
}
