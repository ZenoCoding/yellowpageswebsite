import {getAdmins, getArticleContent, getAuthorDirectoryForServer, buildStaffDataForArticle} from '../../lib/firebase'
import {getApp} from "firebase/app"
import {doc, getDoc, getFirestore, updateDoc, deleteDoc} from "firebase/firestore"
import {getDownloadURL, getStorage, ref, uploadBytesResumable, deleteObject} from "firebase/storage";
import {remark} from 'remark';
import {useRouter} from 'next/router';
import {getAuth} from "firebase/auth";
import {useUser} from "../../firebase/useUser";
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import html from 'remark-html';
import {parseISO} from 'date-fns'
import ContentNavbar from "../../components/ContentNavbar";
import NoAuth from "../../components/auth/NoAuth";
import ArticlePreview from "../../components/ArticlePreview";
import ArticleCardPreview from "../../components/ArticleCardPreview";
import TokenMultiSelect from "../../components/TokenMultiSelect";
import AuthorMultiSelect from "../../components/AuthorMultiSelect";
import ImageUploadAssistant from "../../components/ImageUploadAssistant";
import {useAuthors} from "../../hooks/useAuthors";
import matter from "gray-matter";
import {syncAuthorArticleLinks} from "../../lib/authors";
import {extractImageTokenIds, replaceImageTokensWithFigures} from "../../lib/articleImages";

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

//reinstating, not in lib/firebase cause fs being stinky
const app = getApp()
const db = getFirestore(app)
const storage = getStorage(app)

const DEFAULT_TAG_OPTIONS = ['news', 'feature', 'opinion', 'sports', 'ae', 'hob', 'creative', 'student life', 'events'];
const EDIT_FORM_DRAFT_PREFIX = 'yellowpages-edit-draft-';
export default function Post({articleData, content, admins}) {
    const auth = getAuth();
    const {user} = useUser();
    const router = useRouter();
    const articleId = router.query.id
    const editDraftStorageKey = typeof articleId === 'string' ? `${EDIT_FORM_DRAFT_PREFIX}${articleId}` : null;
    const adminIdSet = useMemo(() => {
        return new Set(Array.isArray(admins) ? admins : []);
    }, [admins]);
    const isAdmin = useMemo(() => {
        if (!user) return false;
        return adminIdSet.has(user.id);
    }, [adminIdSet, user]);
    const {authors, loading: authorsLoading} = useAuthors({enabled: isAdmin});
    const authorLookup = useMemo(() => {
        const map = new Map();
        authors.forEach((author) => {
            if (author?.id) {
                map.set(author.id, author);
            }
        });
        return map;
    }, [authors]);
    const authorNameLookup = useMemo(() => {
        const map = new Map();
        authors.forEach((author) => {
            const key = author.fullName?.trim().toLowerCase();
            if (key) {
                map.set(key, author);
            }
        });
        return map;
    }, [authors]);

    const isAuthorized = Boolean(user) && isAdmin;

    const initialTags = Array.isArray(articleData.tags)
        ? articleData.tags
        : typeof articleData.tags === 'string'
            ? articleData.tags
                .split(',')
                .map((tag) => tag.trim())
                .filter((tag) => tag.length > 0)
            : [];

    const initialAuthors = Array.isArray(articleData.staffNames) && articleData.staffNames.length > 0
        ? articleData.staffNames
        : Array.isArray(articleData.author)
            ? articleData.author
            : typeof articleData.author === 'string'
                ? articleData.author
                    .split(',')
                    .map((author) => author.trim())
                    .filter((author) => author.length > 0)
                : [];

    const initialAuthorIds = Array.isArray(articleData.authorIds)
        ? articleData.authorIds
            .filter((authorId) => typeof authorId === 'string' && authorId.trim().length > 0)
        : [];

    const previousAuthorIdsRef = useRef(initialAuthorIds);

    const [formData, setFormData] = useState({
        title: articleData.title,
        authors: initialAuthors,
        authorIds: initialAuthorIds,
        date: articleData.date,
        blurb: articleData.blurb,
        tags: initialTags,
        imageUrl: articleData.imageUrl || '',
        featuredImageId: typeof articleData.featuredImageId === 'string' ? articleData.featuredImageId : '',
        size: articleData.size || 'normal',
        markdown: content.markdown,
    });

    const [uploadData, setUploadData] = useState("");
    const [errorData, setErrorData] = useState("");
    const [isUploading, setIsUploading] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const [htmlData, setHtmlData] = useState("");
    const markdownTextareaRef = useRef(null);
    const handleImageRecordUpdate = useCallback((record) => {
        if (!record?.id) {
            return;
        }
        setImageMetadata((previous) => {
            const next = new Map(previous);
            next.set(record.id, {
                id: record.id,
                url: record.url,
                caption: record.caption || '',
                credit: record.credit || '',
                altText: record.altText || '',
            });
            return next;
        });
    }, []);

    const fetchImageMetadataById = useCallback(async (imageId) => {
        try {
            const snapshot = await getDoc(doc(db, 'images', imageId));
            if (!snapshot.exists()) {
                return;
            }
            const data = snapshot.data() || {};
            handleImageRecordUpdate({
                id: snapshot.id,
                url: typeof data.url === 'string' ? data.url : '',
                caption: typeof data.caption === 'string' ? data.caption : '',
                credit: typeof data.credit === 'string' ? data.credit : '',
                altText: typeof data.altText === 'string' ? data.altText : '',
            });
        } catch (error) {
            console.error('Failed to load image metadata', imageId, error);
        }
    }, [handleImageRecordUpdate]);
    const [imageMetadata, setImageMetadata] = useState(() => {
        const initial = new Map();
        if (Array.isArray(content?.referencedImages)) {
            content.referencedImages.forEach((record) => {
                if (record?.id) {
                    initial.set(record.id, record);
                }
            });
        }
        return initial;
    });
    const pendingImageFetchesRef = useRef(new Set());
    const editDraftTimeoutRef = useRef(null);
    const editDraftRestoredKeyRef = useRef(null);

    useEffect(() => {
        if (!isAuthorized || !editDraftStorageKey || typeof window === 'undefined') {
            return;
        }
        if (editDraftRestoredKeyRef.current === editDraftStorageKey) {
            return;
        }
        editDraftRestoredKeyRef.current = editDraftStorageKey;
        try {
            const storedDraft = window.localStorage.getItem(editDraftStorageKey);
            if (!storedDraft) {
                return;
            }
            const parsed = JSON.parse(storedDraft);
            if (parsed && typeof parsed === 'object') {
                setFormData((previous) => ({
                    ...previous,
                    ...parsed,
                }));
            }
        } catch (error) {
            console.error('Failed to restore edit draft', error);
        }
    }, [editDraftStorageKey, isAuthorized]);

    useEffect(() => {
        if (!isAuthorized || !editDraftStorageKey || typeof window === 'undefined') {
            return;
        }
        if (editDraftTimeoutRef.current) {
            clearTimeout(editDraftTimeoutRef.current);
        }
        editDraftTimeoutRef.current = window.setTimeout(() => {
            const payload = JSON.stringify(formData);
            window.localStorage.setItem(editDraftStorageKey, payload);
        }, 800);
        return () => {
            if (editDraftTimeoutRef.current) {
                clearTimeout(editDraftTimeoutRef.current);
            }
        };
    }, [formData, editDraftStorageKey, isAuthorized]);

    useEffect(() => {
        if (!isAuthorized) {
            return;
        }
        setFormData((previous) => {
            const existingIds = Array.isArray(previous.authorIds)
                ? previous.authorIds.filter((authorId) => typeof authorId === 'string' && authorId.trim().length > 0)
                : [];
            const idSet = new Set(existingIds);
            const nextIds = [...existingIds];
            let changed = false;

            previous.authors.forEach((name) => {
                const key = typeof name === 'string' ? name.trim().toLowerCase() : '';
                if (!key) {
                    return;
                }
                const match = authorNameLookup.get(key);
                if (match?.id && !idSet.has(match.id)) {
                    idSet.add(match.id);
                    nextIds.push(match.id);
                    changed = true;
                }
            });

            if (!changed) {
                return previous;
            }

            return {
                ...previous,
                authorIds: nextIds,
            };
        });
    }, [authorNameLookup, isAuthorized]);

    const convertMarkdownToHtml = useCallback(
        async (markdownValue) => {
            const source = typeof markdownValue === 'string' ? markdownValue : '';
            try {
                const withFigures = replaceImageTokensWithFigures(source, imageMetadata);
                const processedContent = await remark().use(html, {sanitize: false}).process(matter(withFigures).content);
                return processedContent.toString();
            } catch (error) {
                throw new Error('Markdown to HTML conversion failed: ' + error.message);
            }
        },
        [imageMetadata]
    );

    useEffect(() => {
        if (!isAuthorized) {
            return;
        }
        setFormData((previous) => {
            if (!Array.isArray(previous.authorIds) || previous.authorIds.length === 0) {
                return previous;
            }
            const nextNames = previous.authorIds
                .map((authorId) => authorLookup.get(authorId)?.fullName?.trim())
                .filter((name) => typeof name === 'string' && name.length > 0);
            const hasChanged =
                nextNames.length !== previous.authors.length ||
                nextNames.some((name, index) => name !== previous.authors[index]);
            if (!hasChanged) {
                return previous;
            }
            return {
                ...previous,
                authors: nextNames,
            };
        });
    }, [authorLookup, isAuthorized]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }
        const tokenIds = extractImageTokenIds(formData.markdown);
        tokenIds.forEach((imageId) => {
            if (!imageId || imageMetadata.has(imageId) || pendingImageFetchesRef.current.has(imageId)) {
                return;
            }
            pendingImageFetchesRef.current.add(imageId);
            fetchImageMetadataById(imageId).finally(() => {
                pendingImageFetchesRef.current.delete(imageId);
            });
        });
    }, [formData.markdown, imageMetadata, fetchImageMetadataById]);

    useEffect(() => {
        if (typeof formData.markdown !== 'string') {
            setHtmlData('');
            return;
        }
        let isActive = true;
        convertMarkdownToHtml(formData.markdown)
            .then((htmlString) => {
                if (isActive) {
                    setHtmlData(htmlString);
                }
            })
            .catch((error) => {
                if (isActive) {
                    console.error('Failed to render markdown preview', error);
                    setHtmlData('');
                }
            });
        return () => {
            isActive = false;
        };
    }, [formData.markdown, convertMarkdownToHtml]);

    // Form input change handlers
    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData((prevFormData) => ({
            ...prevFormData,
            [name]: value,
        }));
    };

    const updateMarkdown = (markdownValue) => {
        setFormData((prevFormData) => ({
            ...prevFormData,
            markdown: markdownValue,
        }));
    };

    const handleMarkdownChange = (e) => {
        updateMarkdown(e.target.value);
    };

    const handleAuthorIdsChange = (authorIds) => {
        const uniqueIds = Array.from(
            new Set(authorIds.filter((authorId) => typeof authorId === 'string' && authorId.trim().length > 0))
        );
        const cleanedNames = uniqueIds
            .map((authorId) => authorLookup.get(authorId)?.fullName?.trim())
            .filter((name) => typeof name === 'string' && name.length > 0);
        setFormData((prevFormData) => ({
            ...prevFormData,
            authorIds: uniqueIds,
            authors: cleanedNames.length > 0 ? cleanedNames : prevFormData.authors,
        }));
    };

    if (!user) {
        return <NoAuth/>;
    }
    if (!isAdmin) {
        return <NoAuth permission={true}/>;
    }

    const handleSetFeaturedImage = (image) => {
        setFormData((prevFormData) => ({
            ...prevFormData,
            imageUrl: image?.url ?? '',
            featuredImageId: image?.id ?? '',
        }));
    };

    const handleInsertImageMarkdown = (value) => {
        const textarea = markdownTextareaRef.current;
        const trimmedValue = typeof value === 'string' ? value.trim() : '';
        const isFigureToken = trimmedValue.startsWith('{{image:');
        const markdownSnippet = isFigureToken ? `\n\n${trimmedValue}\n\n` : `![image description](${trimmedValue})`;

        if (textarea && typeof textarea.selectionStart === 'number' && typeof textarea.selectionEnd === 'number') {
            const {selectionStart, selectionEnd, value: currentValue} = textarea;
            const nextValue = currentValue.slice(0, selectionStart) + markdownSnippet + currentValue.slice(selectionEnd);
            updateMarkdown(nextValue);

            requestAnimationFrame(() => {
                const cursorPosition = selectionStart + markdownSnippet.length;
                textarea.setSelectionRange(cursorPosition, cursorPosition);
                textarea.focus();
            });
        } else {
            updateMarkdown((formData.markdown || '') + `\n\n${markdownSnippet}`);
        }
    };

    const handleTagsChange = (tags) => {
        const cleanedTags = Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
        setFormData((prevFormData) => ({
            ...prevFormData,
            tags: cleanedTags,
        }));
    };

    // Form submission handler
    const handleSubmit = async (e) => {
        e.preventDefault();
        setErrorData('');
        setIsUploading(true);

        // Perform validation checks here
        if (!formData.title || formData.authorIds.length === 0 || !formData.date || formData.tags.length === 0) {
            setErrorData('Please fill out all required fields (title, staff credits, date, tags).');
            setIsUploading(false);
            return;
        }

        // Convert markdown to HTML and validate
        let contentHtml;
        try {
            contentHtml = await convertMarkdownToHtml(formData.markdown);
        } catch (error) {
            setErrorData(error.message);
            setIsUploading(false);
            return;
        }

        // Create a Blob from the markdown content
        const file = new Blob([formData.markdown], {type: "text/plain"});
        const markdownRef = ref(storage, `articles/${articleId}.md`); // Adjust the path as needed

        // Upload the Blob to Firebase Storage
        const uploadTask = uploadBytesResumable(markdownRef, file);

        uploadTask.on('state_changed',
            (snapshot) => {
                // Handle state changes, such as progress, pause, and resume
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                setUploadData('Upload is ' + progress + '% done');
                // ...
            },
            (error) => {
                // Handle unsuccessful uploads
                setErrorData(error.message);
                setIsUploading(false);
            },
            async () => {
                // Handle successful uploads on complete
                try {
                    // Get the download URL for the uploaded markdown content
                    const markdownDownloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                    const dateObject = parseISO(formData.date)

                    const preparedTags = formData.tags.map((tag) => tag.trim()).filter(Boolean);
                    const preparedAuthorIds = formData.authorIds
                        .map((authorId) => authorId.trim())
                        .filter((authorId) => authorId.length > 0);
                    const preparedAuthors = preparedAuthorIds
                        .map((authorId) => authorLookup.get(authorId)?.fullName?.trim())
                        .filter((name) => typeof name === 'string' && name.length > 0);
                    const fallbackAuthorNames = formData.authors.map((author) => author.trim()).filter(Boolean);
                    const authorNamesToPersist = preparedAuthors.length > 0 ? preparedAuthors : fallbackAuthorNames;

                    // Update Firestore document with the new metadata and content references
                    await updateDoc(doc(db, "articles", articleId), {
                        title: formData.title,
                        author: authorNamesToPersist,
                        authorIds: preparedAuthorIds,
                        date: formData.date,
                        blurb: formData.blurb,
                        tags: preparedTags,
                        imageUrl: formData.imageUrl,
                        featuredImageId: formData.featuredImageId || null,
                        size: formData.size,
                        path: `articles/${articleId}.md`,
                    });

                    try {
                        await syncAuthorArticleLinks({
                            articleId,
                            nextAuthorIds: preparedAuthorIds,
                            previousAuthorIds: previousAuthorIdsRef.current,
                        });
                        previousAuthorIdsRef.current = preparedAuthorIds;
                    } catch (linkError) {
                        console.error('Failed to sync author links for edit', linkError);
                    }

                    setUploadData("Upload Successful! Redirecting to the article page...");
                    if (typeof window !== 'undefined' && editDraftStorageKey) {
                        window.localStorage.removeItem(editDraftStorageKey);
                    }
                    // Redirect to the article page in a new tab
                    window.open(`/posts/${articleId}`, '_blank');
                } catch (error) {
                    setErrorData(error.message);
                    setIsUploading(false);
                }
            }
        );
    };

    const handleDelete = async () => {
        if (isDeleting || isUploading) {
            return;
        }
        if (!articleId) {
            setErrorData('Unable to determine article ID.');
            return;
        }
        const confirmed = window.confirm('Delete this article permanently? This cannot be undone.');
        if (!confirmed) {
            return;
        }
        setErrorData('');
        setUploadData('');
        setIsDeleting(true);
        try {
            await deleteDoc(doc(db, "articles", articleId));
            try {
                await deleteObject(ref(storage, `articles/${articleId}.md`));
            } catch (storageError) {
                console.error('Failed to delete markdown file for article', articleId, storageError);
            }
            try {
                await syncAuthorArticleLinks({
                    articleId,
                    nextAuthorIds: [],
                    previousAuthorIds: previousAuthorIdsRef.current || [],
                });
                previousAuthorIdsRef.current = [];
            } catch (linkError) {
                console.error('Failed to sync author links for delete', linkError);
            }
            setUploadData('Article deleted. Redirecting...');
            if (typeof window !== 'undefined' && editDraftStorageKey) {
                window.localStorage.removeItem(editDraftStorageKey);
            }
            await router.replace('/');
        } catch (error) {
            setErrorData(error instanceof Error ? error.message : 'Unable to delete article.');
        } finally {
            setIsDeleting(false);
        }
    };

    // JSX for the form within the Post component
    return (
        <div className="m-auto my-10 px-5 max-w-6xl">
            <ContentNavbar />
            <h1 className="text-3xl">Edit Article</h1>
            <div className="mt-6 lg:mt-10 lg:flex lg:items-start lg:gap-10">
                <form onSubmit={handleSubmit} className="space-y-6 lg:w-1/2">
                    <div>
                        <label htmlFor="title" className="block text-sm font-medium text-gray-700">
                            Title
                        </label>
                        <input
                            id="title"
                            name="title"
                            type="text"
                            required
                            value={formData.title}
                            onChange={handleChange}
                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm sm:text-sm p-2"
                        />
                    </div>

                    <div>
                        <label htmlFor="authors" className="block text-sm font-medium text-gray-700">
                            Staff Credits
                        </label>
                        <AuthorMultiSelect
                            id="authors"
                            authors={authors}
                            value={formData.authorIds}
                            onChange={handleAuthorIdsChange}
                            placeholder={authorsLoading ? 'Loading staff directory…' : 'Search staff by name'}
                            helperText="Pick bylines from the staff directory. Alumni or departed staff appear with an inactive badge."
                            disabled={authorsLoading}
                        />
                    </div>

                    <div>
                        <label htmlFor="date" className="block text-sm font-medium text-gray-700">
                            Date
                        </label>
                        <input
                            id="date"
                            name="date"
                            type="date"
                            required
                            value={formData.date}
                            onChange={handleChange}
                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm sm:text-sm p-2"
                        />
                    </div>

                    <div>
                        <label htmlFor="blurb" className="block text-sm font-medium text-gray-700">
                            Blurb
                        </label>
                        <textarea
                            id="blurb"
                            name="blurb"
                            required
                            value={formData.blurb}
                            onChange={handleChange}
                            rows={2}
                            className="mt-1 block w-full resize-y min-h-[3.5rem] border border-gray-300 rounded-md shadow-sm sm:text-sm p-2"
                        />
                    </div>

                    <div>
                        <label htmlFor="tags" className="block text-sm font-medium text-gray-700">
                            Tags
                        </label>
                        <TokenMultiSelect
                            id="tags"
                            value={formData.tags}
                            onChange={handleTagsChange}
                            options={DEFAULT_TAG_OPTIONS}
                            placeholder="Search or type a tag"
                            helperText="Pick from popular tags or type to create new ones."
                            createLabel={(token) => `Add tag "${token}"`}
                            emptyStateText="No matching tags"
                        />
                    </div>

                    <div>
                        <label htmlFor="imageUrl" className="block text-sm font-medium text-gray-700">
                            Image URL
                        </label>
                        <input
                            id="imageUrl"
                            name="imageUrl"
                            type="text"
                            value={formData.imageUrl}
                            onChange={handleChange}
                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm sm:text-sm p-2"
                        />
                        {formData.featuredImageId && (
                            <p className="mt-1 text-xs text-slate-500">
                                Linked library image ID:&nbsp;
                                <span className="font-mono">{formData.featuredImageId}</span>
                            </p>
                        )}
                    </div>

                    <ImageUploadAssistant
                        onSetFeatured={handleSetFeaturedImage}
                        onInsertIntoMarkdown={handleInsertImageMarkdown}
                        onImageRecordUpdate={handleImageRecordUpdate}
                        articleId={typeof articleId === 'string' ? articleId : null}
                    />

                    <div>
                        <label htmlFor="size" className="block text-sm font-medium text-gray-700">
                            Article Size
                        </label>
                        <select
                            id="size"
                            name="size"
                            value={formData.size}
                            onChange={handleChange}
                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm sm:text-sm p-2"
                        >
                            <option value="normal">Normal</option>
                            <option value="medium">Medium</option>
                            <option value="large">Large</option>
                            <option value="small">Small</option>
                        </select>
                    </div>

                    <div>
                        <label htmlFor="markdown" className="block text-sm font-medium text-gray-700">
                            Markdown
                        </label>
                        <textarea
                            id="markdown"
                            name="markdown"
                            required
                            value={formData.markdown}
                            onChange={handleMarkdownChange}
                            ref={markdownTextareaRef}
                            rows={18}
                            className="mt-1 block w-full resize-y border border-gray-300 rounded-md shadow-sm sm:text-sm p-3 font-mono text-sm"
                        />
                    </div>

                    <div className="flex flex-col gap-3">
                        <div className="flex items-center flex-wrap gap-3">
                            <button
                                type="submit"
                                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-60"
                                disabled={isUploading || isDeleting}
                            >
                                {isUploading ? 'Updating...' : 'Update Article'}
                            </button>
                            <button
                                type="button"
                                onClick={handleDelete}
                                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-60"
                                disabled={isUploading || isDeleting}
                            >
                                {isDeleting ? 'Deleting...' : 'Delete Article'}
                            </button>
                        </div>
                        {errorData && <p className="text-red-500">{errorData}</p>}
                        {uploadData && <p className="text-green-500">{uploadData}</p>}
                    </div>
                </form>
                <div className="mt-10 flex flex-col gap-10 lg:mt-0 lg:w-1/2">
                    <ArticleCardPreview formData={formData} />
                    <ArticlePreview html={htmlData} formData={formData} />
                </div>
            </div>
        </div>
    );
}

export async function getServerSideProps({params}) {
    const articleRef = doc(db, "articles", params.id);
    const articleSnapshot = await getDoc(articleRef);

    if (!articleSnapshot.exists()) {
        return {
            notFound: true,
        };
    }

    const rawArticleData = articleSnapshot.data();
    const serializableArticleData = {
        ...rawArticleData,
        date: toIsoString(rawArticleData?.date) || rawArticleData?.date || null,
        lastViewedAt: toIsoString(rawArticleData?.lastViewedAt),
        createdAt: toIsoString(rawArticleData?.createdAt),
        updatedAt: toIsoString(rawArticleData?.updatedAt),
        publishedAt: toIsoString(rawArticleData?.publishedAt),
    };
    const authorDirectory = await getAuthorDirectoryForServer();
    const staffData = buildStaffDataForArticle(serializableArticleData, authorDirectory);
    const content = await getArticleContent(params.id)
    const admins = await getAdmins();
    const ret = admins.admins;
    return {
        props: {
            articleData: {
                ...serializableArticleData,
                author: staffData.staffNames,
                staffNames: staffData.staffNames,
                staffProfiles: staffData.staffProfiles,
                authorIds: staffData.authorIds,
            },
            content: content,
            admins: ret
        }
    }
}
