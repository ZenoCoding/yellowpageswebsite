import Date from '../components/date'
import {getAdmins} from '../lib/firebase'
import {getApp} from "firebase/app"
import {doc, getDoc, getFirestore, setDoc} from "firebase/firestore"
import {getDownloadURL, getStorage, ref, uploadBytesResumable} from "firebase/storage";
import {remark} from 'remark';
import {useRouter} from 'next/router';
import {getAuth} from "firebase/auth";
import {useUser} from "../firebase/useUser";
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import html from 'remark-html';
import {format, parseISO} from 'date-fns'
import NoAuth from "../components/auth/NoAuth";
import ContentNavbar from "../components/ContentNavbar";
import ArticlePreview from "../components/ArticlePreview";
import ArticleCardPreview from "../components/ArticleCardPreview";
import TokenMultiSelect from "../components/TokenMultiSelect";
import AuthorMultiSelect from "../components/AuthorMultiSelect";
import ImageUploadAssistant from "../components/ImageUploadAssistant";
import {useAuthors} from "../hooks/useAuthors";
import {syncAuthorArticleLinks} from "../lib/authors";
import matter from "gray-matter";
import {extractImageTokenIds, replaceImageTokensWithFigures} from "../lib/articleImages";

// var user_id = null;

//reinstating, not in lib/firebase cause fs being stinky
const app = getApp()
const db = getFirestore(app)
const storage = getStorage(app)

const DEFAULT_TAG_OPTIONS = ['news', 'feature', 'opinion', 'sports', 'ae', 'hob', 'creative', 'student life', 'events'];
const UPLOAD_FORM_DEFAULTS_KEY = 'yellowpages-upload-defaults';
const UPLOAD_FORM_DRAFT_KEY = 'yellowpages-upload-draft-v1';

const isListLikeLine = (line) => {
    return /^([-*+])\s+/.test(line) || /^\d+\.\s+/.test(line);
};

const areTagListsEqual = (first, second) => {
    if (!Array.isArray(first) || !Array.isArray(second)) {
        return false;
    }
    if (first.length !== second.length) {
        return false;
    }
    return first.every((value, index) => value === second[index]);
};

const needsParagraphBreak = (currentLine, nextLine) => {
    if (!nextLine) {
        return false;
    }
    const trimmedCurrent = currentLine.trim();
    const trimmedNext = nextLine.trim();
    if (trimmedCurrent.length === 0 || trimmedNext.length === 0) {
        return false;
    }
    if (/^[>#|]/.test(trimmedNext)) {
        return false;
    }
    if (isListLikeLine(trimmedNext)) {
        return false;
    }
    return true;
};

const ensureParagraphSpacing = (input) => {
    const lines = input.split('\n');
    if (lines.length <= 1) {
        return input;
    }
    const output = [];
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        output.push(line);
        if (needsParagraphBreak(line, lines[index + 1])) {
            output.push('');
        }
    }
    return output.join('\n');
};

const cleanMarkdownSource = (input) => {
    if (typeof input !== 'string') {
        return '';
    }
    let result = input.replace(/\r\n/g, '\n').replace(/\u00A0/g, ' ');
    result = result.replace(/^[ \t]{4,6}(?=\S)/gm, '');
    result = result.replace(/[ \t]+\n/g, '\n');
    result = result.replace(/\n{3,}/g, '\n\n');
    result = ensureParagraphSpacing(result);
    result = result.replace(/\n{3,}/g, '\n\n');
    return result.trim();
};

export default function Upload({admins}) {
    const auth = getAuth();
    const {user} = useUser();
    const router = useRouter();
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

    const [formData, setFormData] = useState({
        title: "",
        authors: [],
        authorIds: [],
        date: "",
        blurb: "",
        tags: [],
        imageUrl: "",
        featuredImageId: "",
        size: 'normal',
        markdown: "",
    });
    const [savedDefaults, setSavedDefaults] = useState(() => ({date: '', tags: []}));

    const [uploadData, setUploadData] = useState("");
    const [errorData, setErrorData] = useState("");
    const [isUploading, setIsUploading] = useState(false);

    const [htmlData, setHtmlData] = useState("");
    const markdownTextareaRef = useRef(null);
    const [imageMetadata, setImageMetadata] = useState(() => new Map());
    const pendingImageFetchesRef = useRef(new Set());
    const uploadDraftTimeoutRef = useRef(null);
    const uploadDraftRestoredRef = useRef(false);
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
        if (!isAdmin || typeof window === 'undefined' || uploadDraftRestoredRef.current) {
            return;
        }
        uploadDraftRestoredRef.current = true;
        try {
            const storedDraft = window.localStorage.getItem(UPLOAD_FORM_DRAFT_KEY);
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
            console.error('Failed to restore upload draft', error);
        }
    }, [isAdmin]);

    useEffect(() => {
        if (!isAdmin || typeof window === 'undefined') {
            return;
        }
        if (uploadDraftTimeoutRef.current) {
            clearTimeout(uploadDraftTimeoutRef.current);
        }
        uploadDraftTimeoutRef.current = window.setTimeout(() => {
            const payload = JSON.stringify(formData);
            window.localStorage.setItem(UPLOAD_FORM_DRAFT_KEY, payload);
        }, 800);
        return () => {
            if (uploadDraftTimeoutRef.current) {
                clearTimeout(uploadDraftTimeoutRef.current);
            }
        };
    }, [formData, isAdmin]);

    useEffect(() => {
        if (!isAdmin) {
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
    }, [authorLookup, isAdmin]);

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

    useEffect(() => {
        if (typeof window === 'undefined' || !isAdmin) {
            return;
        }
        try {
            const stored = window.localStorage.getItem(UPLOAD_FORM_DEFAULTS_KEY);
            if (!stored) {
                return;
            }
            const parsed = JSON.parse(stored);
            const nextDefaults = {
                date: typeof parsed?.date === 'string' ? parsed.date : '',
                tags: Array.isArray(parsed?.tags)
                    ? parsed.tags.filter((tag) => typeof tag === 'string' && tag.trim().length > 0)
                    : [],
            };
            setSavedDefaults((previous) => {
                if (
                    previous.date === nextDefaults.date &&
                    areTagListsEqual(previous.tags, nextDefaults.tags)
                ) {
                    return previous;
                }
                return nextDefaults;
            });
            setFormData((previous) => {
                const hasDate = typeof previous.date === 'string' && previous.date.trim().length > 0;
                const hasTags = Array.isArray(previous.tags) && previous.tags.length > 0;
                if (hasDate && hasTags) {
                    return previous;
                }
                return {
                    ...previous,
                    date: hasDate ? previous.date : nextDefaults.date ?? '',
                    tags: hasTags ? previous.tags : nextDefaults.tags,
                };
            });
        } catch (error) {
            console.error('Failed to load saved upload defaults', error);
        }
    }, [isAdmin]);

    useEffect(() => {
        if (typeof window === 'undefined' || !isAdmin) {
            return;
        }
        const hasDate = typeof formData.date === 'string' && formData.date.trim().length > 0;
        const hasTags = Array.isArray(formData.tags) && formData.tags.length > 0;
        if (!hasDate && !hasTags) {
            window.localStorage.removeItem(UPLOAD_FORM_DEFAULTS_KEY);
            setSavedDefaults((previous) => {
                if (previous.date === '' && previous.tags.length === 0) {
                    return previous;
                }
                return {date: '', tags: []};
            });
            return;
        }
        const nextDefaults = {
            date: hasDate ? formData.date : '',
            tags: hasTags ? [...formData.tags] : [],
        };
        window.localStorage.setItem(UPLOAD_FORM_DEFAULTS_KEY, JSON.stringify(nextDefaults));
        setSavedDefaults((previous) => {
            if (
                previous.date === nextDefaults.date &&
                areTagListsEqual(previous.tags, nextDefaults.tags)
            ) {
                return previous;
            }
            return nextDefaults;
        });
    }, [formData.date, formData.tags, isAdmin]);

    const draftArticleId = useMemo(() => {
        if (!formData.title || !formData.date) {
            return null;
        }

        try {
            const urlifyFactory = require('urlify').create({
                addEToUmlauts: true,
                szToSs: true,
                spaces: "_",
                nonPrintable: "_",
                trim: true
            });

            const dateObject = parseISO(formData.date);
            if (Number.isNaN(dateObject?.getTime?.())) {
                return null;
            }

            return format(dateObject, 'yyyy-MM-dd') + '_' + urlifyFactory(formData.title);
        } catch (error) {
            console.error('Unable to derive draft article id', error);
            return null;
        }
    }, [formData.title, formData.date]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData((prevFormData) => ({
            ...prevFormData,
            [name]: value,
        }));
    };

    const updateMarkdown = useCallback((markdownValue) => {
        setFormData((prevFormData) => ({
            ...prevFormData,
            markdown: markdownValue,
        }));
    }, []);

    const handleMarkdownPaste = useCallback((event) => {
        if (!event?.clipboardData) {
            return;
        }
        event.preventDefault();
        const pasted = event.clipboardData.getData('text/plain');
        const cleaned = cleanMarkdownSource(pasted);
        const textarea = markdownTextareaRef.current;

        if (textarea && typeof textarea.selectionStart === 'number' && typeof textarea.selectionEnd === 'number') {
            const {selectionStart, selectionEnd, value} = textarea;
            const nextValue = value.slice(0, selectionStart) + cleaned + value.slice(selectionEnd);
            updateMarkdown(nextValue);

            requestAnimationFrame(() => {
                const cursorPosition = selectionStart + cleaned.length;
                textarea.setSelectionRange(cursorPosition, cursorPosition);
                textarea.focus();
            });
        } else {
            updateMarkdown(cleaned);
        }
    }, [updateMarkdown]);

    const handleApplySavedDate = useCallback(() => {
        if (!savedDefaults.date) {
            return;
        }
        setFormData((previous) => ({
            ...previous,
            date: savedDefaults.date,
        }));
    }, [savedDefaults.date]);

    const handleApplySavedTags = useCallback(() => {
        if (!Array.isArray(savedDefaults.tags) || savedDefaults.tags.length === 0) {
            return;
        }
        setFormData((previous) => ({
            ...previous,
            tags: [...savedDefaults.tags],
        }));
    }, [savedDefaults.tags]);

    const handleClearSavedDefaults = useCallback(() => {
        if (typeof window !== 'undefined') {
            window.localStorage.removeItem(UPLOAD_FORM_DEFAULTS_KEY);
        }
        setSavedDefaults({date: '', tags: []});
        setFormData((previous) => ({
            ...previous,
            date: '',
            tags: [],
        }));
    }, []);

    const handleCleanFormatting = useCallback(() => {
        updateMarkdown(cleanMarkdownSource(formData.markdown));
    }, [formData.markdown, updateMarkdown]);

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
            authors: cleanedNames,
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
        const articleId = draftArticleId;
        if (!articleId) {
            setErrorData('Please ensure the article has a valid title and date before uploading.');
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
                    await setDoc(doc(db, "articles", articleId), {
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
                            previousAuthorIds: [],
                        });
                    } catch (linkError) {
                        console.error('Failed to sync author links for upload', linkError);
                    }

                    setUploadData("Upload Successful!");
                    if (typeof window !== 'undefined') {
                        window.localStorage.removeItem(UPLOAD_FORM_DRAFT_KEY);
                    }
                    await router.push(`/posts/${articleId}`);
                } catch (error) {
                    setErrorData(error.message);
                    setIsUploading(false);
                }
            }
        );
    };

    // JSX for the form within the Post component
    return (
        <div className="m-auto my-10 px-5 max-w-6xl">
            <ContentNavbar/>
            <h1 className="text-3xl font-bold mb-3">Upload Article</h1>
            <div className="mt-6 lg:mt-10 lg:flex lg:items-start lg:gap-10">
                <form onSubmit={handleSubmit} autoComplete="off" className="space-y-6 lg:w-1/2">
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
                            autoComplete="off"
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
                        <div className="flex items-center justify-between">
                            <label htmlFor="date" className="block text-sm font-medium text-gray-700">
                                Date
                            </label>
                            {savedDefaults.date &&
                                savedDefaults.date !== formData.date && (
                                    <button
                                        type="button"
                                        onClick={handleApplySavedDate}
                                        className="text-xs font-medium text-indigo-600 hover:text-indigo-500"
                                    >
                                        Use saved date
                                    </button>
                                )}
                        </div>
                        <input
                            id="date"
                            name="date"
                            type="date"
                            required
                            value={formData.date}
                            onChange={handleChange}
                            autoComplete="off"
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
                            autoComplete="off"
                            rows={2}
                            className="mt-1 block w-full resize-y min-h-[3.5rem] border border-gray-300 rounded-md shadow-sm sm:text-sm p-2"
                        />
                    </div>

                    <div>
                        <div className="flex items-center justify-between">
                            <label htmlFor="tags" className="block text-sm font-medium text-gray-700">
                                Tags
                            </label>
                            <div className="flex items-center gap-3">
                                {savedDefaults.tags.length > 0 &&
                                    !areTagListsEqual(savedDefaults.tags, formData.tags) && (
                                        <button
                                            type="button"
                                            onClick={handleApplySavedTags}
                                            className="text-xs font-medium text-indigo-600 hover:text-indigo-500"
                                        >
                                            Use saved tags
                                        </button>
                                    )}
                                {(savedDefaults.date || savedDefaults.tags.length > 0) && (
                                    <button
                                        type="button"
                                        onClick={handleClearSavedDefaults}
                                        className="text-xs text-slate-500 hover:text-slate-700"
                                    >
                                        Clear saved defaults
                                    </button>
                                )}
                            </div>
                        </div>
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
                            autoComplete="off"
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
                        articleId={draftArticleId}
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
                            autoComplete="off"
                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm sm:text-sm p-2"
                        >
                            <option value="normal">Normal</option>
                            <option value="medium">Medium</option>
                            <option value="large">Large</option>
                            <option value="small">Small</option>
                        </select>
                    </div>

                    <div>
                        <div className="flex items-center justify-between">
                            <label htmlFor="markdown" className="block text-sm font-medium text-gray-700">
                                Markdown
                            </label>
                            <button
                                type="button"
                                onClick={handleCleanFormatting}
                                className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
                            >
                                Clean formatting
                            </button>
                        </div>
                        <textarea
                            id="markdown"
                            name="markdown"
                            required
                            value={formData.markdown}
                            onChange={handleMarkdownChange}
                            onPaste={handleMarkdownPaste}
                            ref={markdownTextareaRef}
                            rows={18}
                            className="mt-1 block w-full resize-y border border-gray-300 rounded-md shadow-sm sm:text-sm p-3 font-mono text-sm"
                        />
                    </div>

                    <a href={"https://docs.google.com/document/d/1_lNHBxtpaBa1JRqrbapmCj_L_k-yfSsTSkgGp_1pnL0/edit"}
                       className="underline italic text-gray-500">Confused?</a>

                    <div className="flex items-center justify-between flex-wrap gap-3">
                        <button
                            type="submit"
                            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                            disabled={isUploading}
                        >
                            {isUploading ? 'Uploading...' : 'Upload Article'}
                        </button>
                        {errorData && <p className="text-red-500">{errorData}</p>}
                        {uploadData && <p className="text-green-500">{uploadData}</p>}
                    </div>
                </form>
                <div className="mt-10 flex flex-col gap-10 lg:mt-0 lg:w-1/2">
                    <ArticleCardPreview formData={formData}/>
                    <ArticlePreview formData={formData} html={htmlData}/>
                </div>
            </div>
        </div>
    );
};

export async function getServerSideProps({params}) {
    const admins = await getAdmins();
    const ret = admins.admins;
    return {
        props: {
            admins: ret
        }
    }
}
