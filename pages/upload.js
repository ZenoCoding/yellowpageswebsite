import Date from '../components/date'
import {getAdmins} from '../lib/firebase'
import {getApp} from "firebase/app"
import {collection, doc, getDoc, getDocs, getFirestore, serverTimestamp, setDoc, updateDoc} from "firebase/firestore"
import {getStorage, ref, uploadBytesResumable} from "firebase/storage";
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
import {insertInlineImageTokens, repositionLeadingInlineImageTokens} from '../lib/articleMediaPlacement';
import ImportedMediaPanel from "../components/ImportedMediaPanel";
import {IMPORT_MEDIA_STORAGE_KEY} from "../lib/importHandoff";
import {getDraftAutomationState, getDraftReviewContext, getDraftReviewItems, isClosedDraftStatus} from '../lib/articleAutomation';

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
    const [importedMediaItems, setImportedMediaItems] = useState([]);
    const [issues, setIssues] = useState([]);
    const [issueId, setIssueId] = useState('');
    const [draftStatus, setDraftStatus] = useState('needs_review');
    const [draftContext, setDraftContext] = useState(null);
    const [reviewedBlockers, setReviewedBlockers] = useState([]);
    const [previewMode, setPreviewMode] = useState('article');
    const [draftLoaded, setDraftLoaded] = useState(false);
    const [saveState, setSaveState] = useState('');
    const newsroomDraftId = typeof router.query.draftId === 'string' ? router.query.draftId : '';

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
                creditType: record.creditType || null,
                sourceUrl: record.sourceUrl || null,
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
                creditType: typeof data.creditType === 'string' ? data.creditType : null,
                sourceUrl: typeof data.sourceUrl === 'string' ? data.sourceUrl : null,
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
        if (!isAdmin || !router.isReady || typeof window === 'undefined' || uploadDraftRestoredRef.current) {
            return;
        }
        uploadDraftRestoredRef.current = true;
        const restoreDraft = async () => {
            try {
                const issueSnapshot = await getDocs(collection(db, 'issues'));
                setIssues(issueSnapshot.docs.map((item) => ({id: item.id, ...item.data()})));
                if (newsroomDraftId) {
                    const snapshot = await getDoc(doc(db, 'articleDrafts', newsroomDraftId));
                    if (!snapshot.exists()) throw new Error('This newsroom draft no longer exists.');
                    const data = snapshot.data() || {};
                    const mediaItems = Array.isArray(data.mediaItems) ? data.mediaItems : [];
                    const repairedMarkdown = repositionLeadingInlineImageTokens(data.markdown || '', mediaItems
                        .filter((item) => item.role === 'inline' && item.importedImageId)
                        .map((item) => ({id: item.importedImageId, insertAfterParagraph: item.insertAfterParagraph})));
                    setFormData((previous) => ({
                        ...previous,
                        title: data.title || '',
                        authors: Array.isArray(data.authors) ? data.authors : [],
                        authorIds: Array.isArray(data.authorIds) ? data.authorIds : [],
                        date: data.date || data.publicationDate || '',
                        blurb: data.blurb || '',
                        tags: Array.isArray(data.tags) ? data.tags : [],
                        imageUrl: data.imageUrl || '',
                        featuredImageId: data.featuredImageId || '',
                        size: data.size || 'normal',
                        markdown: repairedMarkdown,
                    }));
                    setImportedMediaItems(mediaItems);
                    setIssueId(data.issueId || '');
                    setDraftStatus(data.status || 'needs_review');
                    setReviewedBlockers(Array.isArray(data.reviewedBlockers) ? data.reviewedBlockers : []);
                    setDraftContext({
                        source: data.source || null,
                        sourceRevision: data.sourceRevision || null,
                        ai: data.ai || null,
                        blockers: data.blockers || [],
                        unmatchedAuthors: data.unmatchedAuthors || [],
                    });
                    return;
                }
                const storedDraft = window.localStorage.getItem(UPLOAD_FORM_DRAFT_KEY);
                if (storedDraft) {
                    const parsed = JSON.parse(storedDraft);
                    if (parsed && typeof parsed === 'object') setFormData((previous) => ({...previous, ...parsed}));
                }
                const storedMedia = window.localStorage.getItem(IMPORT_MEDIA_STORAGE_KEY);
                const parsedMedia = storedMedia ? JSON.parse(storedMedia) : [];
                setImportedMediaItems(Array.isArray(parsedMedia) ? parsedMedia : []);
            } catch (error) {
                setErrorData(error?.message || 'Failed to restore the newsroom draft.');
            } finally {
                setDraftLoaded(true);
            }
        };
        restoreDraft();
    }, [isAdmin, newsroomDraftId, router.isReady]);

    const handleImportedMediaChange = useCallback((items) => {
        const nextItems = Array.isArray(items) ? items : [];
        setImportedMediaItems(nextItems);
        if (!newsroomDraftId && typeof window !== 'undefined') {
            if (nextItems.length > 0) {
                window.localStorage.setItem(IMPORT_MEDIA_STORAGE_KEY, JSON.stringify(nextItems));
            } else {
                window.localStorage.removeItem(IMPORT_MEDIA_STORAGE_KEY);
            }
        }
    }, [newsroomDraftId]);

    const automationState = useMemo(() => newsroomDraftId ? getDraftAutomationState({
        ...draftContext,
        status: draftStatus,
        reviewedBlockers,
    }, formData) : {status: 'ready', blockers: []}, [draftContext, draftStatus, formData, newsroomDraftId, reviewedBlockers]);
    const remainingBlockers = automationState.blockers;
    const automaticDraftStatus = automationState.status;
    const closedDraft = isClosedDraftStatus(draftStatus);

    useEffect(() => {
        if (!isAdmin || !draftLoaded || typeof window === 'undefined' || (newsroomDraftId && closedDraft)) {
            return;
        }
        if (uploadDraftTimeoutRef.current) {
            clearTimeout(uploadDraftTimeoutRef.current);
        }
        uploadDraftTimeoutRef.current = window.setTimeout(async () => {
            if (newsroomDraftId) {
                setSaveState('Saving…');
                try {
                    await updateDoc(doc(db, 'articleDrafts', newsroomDraftId), {
                        ...formData,
                        issueId: issueId || null,
                        status: automaticDraftStatus,
                        blockers: remainingBlockers,
                        reviewedBlockers,
                        unmatchedAuthors: draftContext?.unmatchedAuthors || [],
                        source: draftContext?.source || null,
                        sourceRevision: draftContext?.sourceRevision || null,
                        ai: draftContext?.ai || null,
                        mediaItems: importedMediaItems,
                        updatedAt: serverTimestamp(),
                    });
                    setSaveState('Saved');
                } catch (error) {
                    setSaveState('Save failed');
                    console.error('Failed to save newsroom draft', error);
                }
                return;
            }
            window.localStorage.setItem(UPLOAD_FORM_DRAFT_KEY, JSON.stringify(formData));
            setSaveState('Saved in this browser');
        }, 800);
        return () => {
            if (uploadDraftTimeoutRef.current) {
                clearTimeout(uploadDraftTimeoutRef.current);
            }
        };
    }, [automaticDraftStatus, closedDraft, draftContext?.ai, draftContext?.source, draftContext?.sourceRevision, draftContext?.unmatchedAuthors, draftLoaded, formData, importedMediaItems, isAdmin, issueId, newsroomDraftId, remainingBlockers, reviewedBlockers]);

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

    const handleIssueChange = (event) => {
        const nextIssueId = event.target.value;
        const selectedIssue = issues.find((issue) => issue.id === nextIssueId);
        setIssueId(nextIssueId);
        if (selectedIssue?.targetPublicationDate) {
            setFormData((previous) => ({...previous, date: selectedIssue.targetPublicationDate}));
        }
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
        if (newsroomDraftId) setDraftContext((previous) => previous ? {...previous, unmatchedAuthors: []} : previous);
    };

    if (!user) {
        return <NoAuth/>;
    }
    if (!isAdmin) {
        return <NoAuth permission={true}/>;
    }
    if (newsroomDraftId && !draftLoaded) {
        return <div className="min-h-screen bg-slate-50"><ContentNavbar/><div className="mx-auto max-w-6xl px-5 py-20 text-sm text-slate-500">Loading newsroom draft…</div></div>;
    }

    const handleSetFeaturedImage = (image) => {
        setFormData((prevFormData) => ({
            ...prevFormData,
            imageUrl: image?.url ?? '',
            featuredImageId: image?.id ?? '',
        }));
    };

    const handleInsertImageMarkdown = (value, placement = {}) => {
        const textarea = markdownTextareaRef.current;
        const trimmedValue = typeof value === 'string' ? value.trim() : '';
        const isFigureToken = trimmedValue.startsWith('{{image:');
        const imageId = isFigureToken ? trimmedValue.match(/^\{\{\s*image:([a-zA-Z0-9_-]+)\s*\}\}$/i)?.[1] : null;
        if (imageId && placement.automaticPlacement) {
            setFormData((previous) => ({
                ...previous,
                markdown: insertInlineImageTokens(previous.markdown, [{
                    id: imageId,
                    insertAfterParagraph: placement.insertAfterParagraph,
                    sequenceIndex: placement.sequenceIndex,
                    sequenceCount: placement.sequenceCount,
                }]),
            }));
            return;
        }
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
        if (newsroomDraftId) {
            setErrorData(issueId ? 'Publish this story with its issue.' : 'Newsroom drafts must be published from the newsroom.');
            return;
        }
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

        const preparedTags = formData.tags.map((tag) => tag.trim()).filter(Boolean);
        const preparedAuthorIds = formData.authorIds
            .map((authorId) => authorId.trim())
            .filter((authorId) => authorId.length > 0);
        const preparedAuthors = preparedAuthorIds
            .map((authorId) => authorLookup.get(authorId)?.fullName?.trim())
            .filter((name) => typeof name === 'string' && name.length > 0);
        const fallbackAuthorNames = formData.authors.map((author) => author.trim()).filter(Boolean);
        const authorNamesToPersist = preparedAuthors.length > 0 ? preparedAuthors : fallbackAuthorNames;

        const persistArticle = async ({storageUnavailable = false} = {}) => {
            await setDoc(doc(db, "articles", articleId), {
                status: 'published',
                title: formData.title,
                author: authorNamesToPersist,
                authorIds: preparedAuthorIds,
                date: formData.date,
                blurb: formData.blurb,
                tags: preparedTags,
                imageUrl: formData.imageUrl,
                featuredImageId: formData.featuredImageId || null,
                size: formData.size,
                issueId: issueId || null,
                publishedAt: serverTimestamp(),
                path: `articles/${articleId}.md`,
                markdown: formData.markdown,
            });

            if (newsroomDraftId) {
                await updateDoc(doc(db, 'articleDrafts', newsroomDraftId), {
                    ...formData,
                    issueId: issueId || null,
                    mediaItems: importedMediaItems,
                    status: 'published',
                    publishedArticleId: articleId,
                    publishedAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                });
            }

            try {
                await syncAuthorArticleLinks({
                    articleId,
                    nextAuthorIds: preparedAuthorIds,
                    previousAuthorIds: [],
                });
            } catch (linkError) {
                console.error('Failed to sync author links for upload', linkError);
            }

            setUploadData(storageUnavailable
                ? 'Article saved using the Firestore backup because file storage is unavailable.'
                : 'Upload Successful!');
            if (typeof window !== 'undefined') {
                window.localStorage.removeItem(UPLOAD_FORM_DRAFT_KEY);
                window.localStorage.removeItem(IMPORT_MEDIA_STORAGE_KEY);
            }
            await router.push(`/posts/${articleId}`);
        };

        // Keep Storage as the primary copy, with Firestore as an outage-safe text backup.
        const uploadTask = uploadBytesResumable(markdownRef, file);

        uploadTask.on('state_changed',
            (snapshot) => {
                // Handle state changes, such as progress, pause, and resume
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                setUploadData('Upload is ' + progress + '% done');
            },
            async (error) => {
                if (error?.code === 'storage/quota-exceeded') {
                    try {
                        await persistArticle({storageUnavailable: true});
                    } catch (fallbackError) {
                        setErrorData(fallbackError.message);
                        setIsUploading(false);
                    }
                    return;
                }
                setErrorData(error.message);
                setIsUploading(false);
            },
            async () => {
                try {
                    await persistArticle();
                } catch (error) {
                    setErrorData(error.message);
                    setIsUploading(false);
                }
            }
        );
    };

    // JSX for the form within the Post component
    const reviewDraft = {...(draftContext || {}), blockers: remainingBlockers};
    const reviewItems = closedDraft ? [] : getDraftReviewItems(reviewDraft);
    const reviewContext = getDraftReviewContext(reviewDraft);
    const confirmBlocker = (blocker) => setReviewedBlockers((current) => Array.from(new Set([...current, blocker])));
    const applySourceRevision = () => {
        const revision = draftContext?.sourceRevision;
        if (!revision || revision.status !== 'pending') return;
        setFormData((previous) => ({
            ...previous,
            title: revision.title || previous.title,
            authors: revision.authors || previous.authors,
            authorIds: revision.authorIds || previous.authorIds,
            blurb: revision.blurb || previous.blurb,
            tags: revision.tags || previous.tags,
            markdown: revision.markdown || previous.markdown,
        }));
        setImportedMediaItems(Array.isArray(revision.mediaItems) ? revision.mediaItems : importedMediaItems);
        setReviewedBlockers((current) => Array.from(new Set([...current, 'source changed since import'])));
        setDraftContext((previous) => ({
            ...previous,
            unmatchedAuthors: revision.unmatchedAuthors || [],
            ai: {...(previous?.ai || {}), ...(revision.ai || {})},
            source: {...(previous?.source || {}), modifiedTime: revision.modifiedTime || previous?.source?.modifiedTime || null, pendingModifiedTime: null},
            sourceRevision: {...revision, status: 'applied'},
        }));
    };
    return (
        <div className="min-h-screen bg-slate-50 pb-16 text-slate-900">
            <ContentNavbar/>
            <header className="border-b border-slate-200 bg-white">
                <div className="mx-auto max-w-7xl px-5 py-6 sm:px-8 lg:px-10">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-600">{newsroomDraftId ? 'Newsroom draft' : 'New story'}</p>
                            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{newsroomDraftId ? 'Edit draft' : 'Create an article'}</h1>
                        </div>
                        <div className="flex items-center gap-3">{newsroomDraftId && <span className={`rounded-full px-3 py-1 text-xs font-bold ${automaticDraftStatus === 'ready' ? 'bg-emerald-100 text-emerald-800' : closedDraft ? 'bg-slate-200 text-slate-700' : 'bg-amber-100 text-amber-900'}`}>{automaticDraftStatus.replaceAll('_', ' ')}</span>}<span className="text-xs font-semibold text-slate-500">{saveState}</span>{newsroomDraftId && <button type="button" onClick={() => router.push('/admin/newsroom')} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-bold hover:border-slate-900">Back</button>}</div>
                    </div>
                </div>
            </header>
            <div className="mx-auto mt-8 max-w-7xl px-5 sm:px-8 lg:flex lg:items-start lg:gap-10 lg:px-10">
                <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4 lg:w-1/2">
                    {newsroomDraftId && reviewItems.length > 0 && <section className="border-2 border-amber-300 bg-amber-50 p-5"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Needs your attention</p><h2 className="mt-1 text-lg font-bold">{reviewItems.length} {reviewItems.length === 1 ? 'item' : 'items'} left</h2></div><div className="mt-4 divide-y divide-amber-200">{reviewItems.map((item) => <div key={item.blocker} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"><p className="text-sm font-medium text-slate-800">{item.action}</p>{item.confirmable ? <button type="button" onClick={() => confirmBlocker(item.blocker)} className="shrink-0 bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700">Reviewed</button> : item.field ? <a href={`#${item.field}`} className="shrink-0 text-xs font-bold text-amber-800 underline">Fix field</a> : null}</div>)}</div>{reviewContext.length > 0 && <details className="mt-4 border-t border-amber-200 pt-3"><summary className="cursor-pointer text-xs font-bold text-amber-800">Why this was flagged</summary><ul className="mt-2 space-y-1 text-sm text-slate-600">{reviewContext.map((note) => <li key={note}>{note}</li>)}</ul></details>}</section>}

                    {draftContext?.source && <details className="rounded-xl border border-slate-200 bg-white px-4 py-3"><summary className="cursor-pointer text-sm font-bold text-slate-700">Source details</summary><div className="mt-3 border-t border-slate-100 pt-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold">{draftContext.source.rootName || draftContext.source.sourceName || 'Google Drive submission'}</p><p className="mt-1 text-xs text-slate-500">{draftContext.source.tabTitle || draftContext.source.documentName || 'Prepared source copy'}</p></div>{draftContext.source.url && <a href={draftContext.source.url} target="_blank" rel="noreferrer" className="text-xs font-bold text-slate-900 underline">Open original</a>}</div>{draftContext.ai?.warnings?.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-600">{draftContext.ai.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}</div></details>}

                    {draftContext?.sourceRevision?.status === 'pending' && <section className="border border-amber-300 bg-white p-4"><p className="text-xs font-bold uppercase tracking-wide text-amber-800">Revised source found</p><div className="mt-2 flex flex-wrap items-end justify-between gap-4"><div><p className="font-bold">{draftContext.sourceRevision.title || 'Updated draft'}</p><p className="mt-1 text-sm text-slate-600">{(draftContext.sourceRevision.authors || []).join(', ') || 'Byline unchanged'}</p></div><button type="button" onClick={applySourceRevision} className="bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-700">Use revised source</button></div></section>}

                    <label className="block text-sm font-bold text-slate-700">Issue<select value={issueId} onChange={handleIssueChange} className="mt-2 block w-full rounded-md border border-slate-300 p-2.5 text-sm font-normal"><option value="">No issue</option>{issues.filter((issue) => issue.status !== 'archived').map((issue) => <option key={issue.id} value={issue.id}>{issue.name}{issue.schoolYear ? ` · ${issue.schoolYear}` : ''}{issue.volumeNumber ? ` · Vol. ${issue.volumeNumber}` : ''}{issue.issueNumber ? `, No. ${issue.issueNumber}` : ''}</option>)}</select></label>
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
                            Byline
                        </label>
                        <AuthorMultiSelect
                            id="authors"
                            authors={authors}
                            value={formData.authorIds}
                            onChange={handleAuthorIdsChange}
                            placeholder={authorsLoading ? 'Loading staff directory…' : 'Search staff by name'}
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
                            createLabel={(token) => `Add tag "${token}"`}
                            emptyStateText="No matching tags"
                        />
                    </div>

                    <details className="rounded-xl border border-slate-200 bg-white p-4">
                        <summary className="cursor-pointer text-sm font-bold text-slate-700">Images and display options{importedMediaItems.length ? ` · ${importedMediaItems.length} source image${importedMediaItems.length === 1 ? '' : 's'}` : ''}</summary>
                        <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
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

                    <ImportedMediaPanel
                        items={importedMediaItems}
                        articleId={draftArticleId}
                        onItemsChange={handleImportedMediaChange}
                        onSetFeatured={handleSetFeaturedImage}
                        onInsertIntoMarkdown={handleInsertImageMarkdown}
                        onImageRecordUpdate={handleImageRecordUpdate}
                    />

                    <ImageUploadAssistant
                        onSetFeatured={handleSetFeaturedImage}
                        onInsertIntoMarkdown={handleInsertImageMarkdown}
                        onImageRecordUpdate={handleImageRecordUpdate}
                        articleId={draftArticleId}
                    />

                    <label htmlFor="size" className="block text-sm font-medium text-gray-700">
                        Front-page size
                        <select
                            id="size"
                            name="size"
                            value={formData.size}
                            onChange={handleChange}
                            autoComplete="off"
                            className="mt-1 block w-full rounded-md border border-gray-300 p-2 text-sm"
                        >
                            <option value="normal">Normal</option>
                            <option value="medium">Medium</option>
                            <option value="large">Large</option>
                            <option value="small">Small</option>
                        </select>
                    </label>

                        </div>
                    </details>

                    <div>
                        <div className="flex items-center justify-between">
                            <label htmlFor="markdown" className="block text-sm font-medium text-gray-700">
                                Article body
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
                       className="text-sm text-slate-500 underline">Formatting guide</a>

                    <div className="flex items-center justify-between flex-wrap gap-3">
                        {newsroomDraftId ? <button type="button" onClick={() => router.push(issueId ? `/admin/issues/${issueId}` : '/admin/newsroom')} className="inline-flex items-center bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700">{issueId ? 'Back to issue' : 'Back to newsroom'}</button> : <button type="submit" className="inline-flex items-center bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-50" disabled={isUploading}>{isUploading ? 'Publishing…' : 'Publish article'}</button>}
                        {errorData && <p className="text-red-500">{errorData}</p>}
                        {uploadData && <p className="text-green-500">{uploadData}</p>}
                    </div>
                </form>
                <div className="mt-10 lg:sticky lg:top-6 lg:mt-0 lg:w-1/2">
                    <div className="mb-4 flex border-b border-slate-300">
                        <button type="button" onClick={() => setPreviewMode('article')} className={`px-4 py-2 text-sm font-bold ${previewMode === 'article' ? 'border-b-2 border-slate-900 text-slate-900' : 'text-slate-500'}`}>Article preview</button>
                        <button type="button" onClick={() => setPreviewMode('front-page')} className={`px-4 py-2 text-sm font-bold ${previewMode === 'front-page' ? 'border-b-2 border-slate-900 text-slate-900' : 'text-slate-500'}`}>Front-page preview</button>
                    </div>
                    {previewMode === 'article' ? <ArticlePreview formData={formData} html={htmlData}/> : <ArticleCardPreview formData={formData}/>}
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
