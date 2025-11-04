import {ChangeEvent, useEffect, useRef, useState} from 'react';
import {getApp} from 'firebase/app';
import {getStorage, ref, uploadBytesResumable, getDownloadURL} from 'firebase/storage';
import {
    addDoc,
    arrayRemove,
    collection,
    doc,
    getDocs,
    getFirestore,
    limit,
    orderBy,
    query,
    serverTimestamp,
    updateDoc,
    where,
} from 'firebase/firestore';
import {useUser} from '../firebase/useUser';

interface ImageUploadAssistantProps {
    onSetFeatured: (url: string) => void;
    onInsertIntoMarkdown: (url: string) => void;
    articleId?: string | null;
}

const app = getApp();
const storage = getStorage(app);
const db = getFirestore(app);

interface ImageRecord {
    id: string;
    url: string;
    storagePath: string;
    fileName: string;
    caption: string;
    credit: string;
    altText: string;
    linkedArticleIds: string[];
    uploadedBy?: string | null;
    uploadedByName?: string | null;
    createdAt?: Date | null;
    lastUsedAt?: Date | null;
}

const MAX_IMAGES = 50;
const MAX_LIBRARY_IMAGES = 100;

const createObjectPath = (file: File) => {
    const sanitizedName = file.name.replace(/\s+/g, '-').toLowerCase();
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return `article-images/${uniqueSuffix}-${sanitizedName}`;
};

export default function ImageUploadAssistant({
                                                 onSetFeatured,
                                                 onInsertIntoMarkdown,
                                                 articleId = null,
                                             }: ImageUploadAssistantProps) {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const {user} = useUser();
    const [articleImages, setArticleImages] = useState<ImageRecord[]>([]);
    const [libraryImages, setLibraryImages] = useState<ImageRecord[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isLoadingArticleImages, setIsLoadingArticleImages] = useState<boolean>(true);
    const [isLibraryOpen, setIsLibraryOpen] = useState(false);
    const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
    const [savingState, setSavingState] = useState<Record<string, boolean>>({});

    const mapDocToImageRecord = (docSnapshot: any): ImageRecord => {
        const data = docSnapshot.data();
        const linkedArticleIds = Array.isArray(data?.linkedArticleIds) ? data.linkedArticleIds : [];

        return {
            id: docSnapshot.id,
            url: data?.url,
            storagePath: data?.storagePath ?? '',
            fileName: data?.fileName ?? data?.name ?? 'image',
            caption: data?.caption ?? '',
            credit: data?.credit ?? '',
            altText: data?.altText ?? '',
            linkedArticleIds,
            uploadedBy: data?.uploadedBy ?? null,
            uploadedByName: data?.uploadedByName ?? null,
            createdAt: data?.createdAt?.toDate?.() ?? null,
            lastUsedAt: data?.lastUsedAt?.toDate?.() ?? null,
        };
    };

    const upsertArticleImage = (record: ImageRecord) => {
        setArticleImages((prev) => {
            const existingIndex = prev.findIndex((item) => item.id === record.id || item.url === record.url);
            if (existingIndex >= 0) {
                const next = [...prev];
                next[existingIndex] = {...next[existingIndex], ...record};
                return next;
            }
            return [record, ...prev].slice(0, MAX_IMAGES);
        });
    };

    const upsertLibraryImage = (record: ImageRecord) => {
        setLibraryImages((prev) => {
            const existingIndex = prev.findIndex((item) => item.id === record.id || item.url === record.url);
            if (existingIndex >= 0) {
                const next = [...prev];
                next[existingIndex] = {...next[existingIndex], ...record};
                return next;
            }
            return [record, ...prev].slice(0, MAX_LIBRARY_IMAGES);
        });
    };

    const setSuccessMessage = (message: string | null) => {
        setStatusMessage(message);
        setErrorMessage(null);
    };

    const setFailureMessage = (message: string | null) => {
        setErrorMessage(message);
        setStatusMessage(null);
    };

    useEffect(() => {
        let isMounted = true;

        const fetchArticleImages = async () => {
            setIsLoadingArticleImages(true);

            if (!articleId) {
                setIsLoadingArticleImages(false);
                return;
            }

            try {
                const imagesRef = collection(db, 'images');
                const articleQuery = query(
                    imagesRef,
                    where('linkedArticleIds', 'array-contains', articleId),
                    limit(MAX_IMAGES)
                );
                const snapshot = await getDocs(articleQuery);
                if (!isMounted) {
                    return;
                }
                const records: ImageRecord[] = snapshot.docs.map(mapDocToImageRecord);
                setArticleImages((prev) => {
                    const combinedMap = new Map<string, ImageRecord>();
                    prev.forEach((item) => {
                        combinedMap.set(item.id, item);
                    });
                    records.forEach((item) => {
                        const existing = combinedMap.get(item.id);
                        combinedMap.set(item.id, existing ? {...existing, ...item} : item);
                    });
                    const combined = Array.from(combinedMap.values());
                    combined.sort((a, b) => {
                        const timeA = a.createdAt ? a.createdAt.getTime() : 0;
                        const timeB = b.createdAt ? b.createdAt.getTime() : 0;
                        return timeB - timeA;
                    });
                    return combined.slice(0, MAX_IMAGES);
                });
            } catch (error: any) {
                setFailureMessage(error?.message || 'Unable to load article images.');
            } finally {
                if (isMounted) {
                    setIsLoadingArticleImages(false);
                }
            }
        };

        fetchArticleImages();

        return () => {
            isMounted = false;
        };
    }, [articleId]);

    const setImageSavingState = (storageKey: string, isSaving: boolean) => {
        setSavingState((prev) => {
            const next = {...prev};
            if (isSaving) {
                next[storageKey] = true;
            } else {
                delete next[storageKey];
            }
            return next;
        });
    };

    const handleChooseFile = () => {
        fileInputRef.current?.click();
    };

    const handleFilesSelected = (event: ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) {
            return;
        }
        // Currently handle only the first file; users can upload again for more.
        uploadFile(files[0]);
        event.target.value = '';
    };

    const uploadFile = (file: File) => {
        setIsUploading(true);
        setUploadProgress(0);
        setFailureMessage(null);
        setSuccessMessage(null);

        const storagePath = createObjectPath(file);
        const storageRef = ref(storage, storagePath);
        const uploadTask = uploadBytesResumable(storageRef, file);

        uploadTask.on(
            'state_changed',
            (snapshot) => {
                const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                setUploadProgress(progress);
            },
            (error) => {
                setIsUploading(false);
                setFailureMessage(error.message || 'Failed to upload image.');
            },
            async () => {
                try {
                    const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                    let newRecord: ImageRecord = {
                        id: `temp-${Date.now()}`,
                        url: downloadURL,
                        storagePath,
                        fileName: file.name,
                        caption: '',
                        credit: '',
                        altText: '',
                        linkedArticleIds: articleId ? [articleId] : [],
                        uploadedBy: user?.id ?? null,
                        uploadedByName: user?.name ?? user?.email ?? null,
                        createdAt: new Date(),
                        lastUsedAt: articleId ? new Date() : null,
                    };

                    let metadataSaved = false;

                    try {
                        const docRef = await addDoc(collection(db, 'images'), {
                            url: downloadURL,
                            storagePath,
                            fileName: file.name,
                            caption: '',
                            credit: '',
                            altText: '',
                            linkedArticleIds: articleId ? [articleId] : [],
                            uploadedBy: user?.id ?? null,
                            uploadedByName: user?.name ?? user?.email ?? null,
                            createdAt: serverTimestamp(),
                            lastUsedAt: articleId ? serverTimestamp() : null,
                        });
                        newRecord = {
                            ...newRecord,
                            id: docRef.id,
                        };
                        metadataSaved = true;
                    } catch (metadataError: any) {
                        const message =
                            metadataError?.message ||
                            'Image uploaded, but we could not save its details. Please try again.';
                        setFailureMessage(message);
                    }

                    upsertArticleImage(newRecord);
                    if (metadataSaved) {
                        upsertLibraryImage(newRecord);
                    }

                    if (metadataSaved) {
                        setSuccessMessage('Image uploaded successfully.');
                    }
                } catch (error: any) {
                    setFailureMessage(error?.message || 'Unable to fetch image URL.');
                } finally {
                    setIsUploading(false);
                    setUploadProgress(0);
                }
            }
        );
    };

    const handleMetadataFieldChange = (
        id: string,
        field: 'caption' | 'credit' | 'altText',
        value: string
    ) => {
        setArticleImages((prev) =>
            prev.map((image) => (image.id === id ? {...image, [field]: value} : image))
        );
        setLibraryImages((prev) =>
            prev.map((image) => (image.id === id ? {...image, [field]: value} : image))
        );
    };

    const handleSaveMetadata = async (
        recordId: string,
        options: {suppressToast?: boolean; recordOverride?: ImageRecord} = {}
    ) => {
        const image =
            (options.recordOverride ??
            articleImages.find((item) => item.id === recordId)) ||
            libraryImages.find((item) => item.id === recordId);
        if (!image) {
            return;
        }

        const savingKey = image.storagePath || image.id;
        setStatusMessage(null);
        setErrorMessage(null);
        setImageSavingState(savingKey, true);

        try {
            if (recordId.startsWith('temp-')) {
                const docRef = await addDoc(collection(db, 'images'), {
                    url: image.url,
                    storagePath: image.storagePath,
                    fileName: image.fileName,
                    caption: image.caption,
                    credit: image.credit,
                    altText: image.altText,
                    linkedArticleIds: image.linkedArticleIds ?? (articleId ? [articleId] : []),
                    uploadedBy: user?.id ?? null,
                    uploadedByName: user?.name ?? user?.email ?? null,
                    createdAt: serverTimestamp(),
                    lastUsedAt: image.linkedArticleIds?.length ? serverTimestamp() : null,
                });

                setArticleImages((prev) =>
                    prev.map((item) =>
                        item.id === recordId
                            ? {
                                ...item,
                                id: docRef.id,
                                linkedArticleIds: image.linkedArticleIds ?? [],
                                uploadedBy: user?.id ?? null,
                                uploadedByName: user?.name ?? user?.email ?? null,
                                createdAt: new Date(),
                            }
                            : item
                    )
                );
                setLibraryImages((prev) =>
                    prev.map((item) =>
                        item.id === recordId
                            ? {
                                ...item,
                                id: docRef.id,
                                linkedArticleIds: image.linkedArticleIds ?? [],
                                uploadedBy: user?.id ?? null,
                                uploadedByName: user?.name ?? user?.email ?? null,
                                createdAt: new Date(),
                            }
                            : item
                    )
                );
            } else {
                await updateDoc(doc(db, 'images', recordId), {
                    caption: image.caption,
                    credit: image.credit,
                    altText: image.altText,
                    fileName: image.fileName,
                    url: image.url,
                    storagePath: image.storagePath,
                    linkedArticleIds: image.linkedArticleIds ?? [],
                    uploadedBy: image.uploadedBy ?? user?.id ?? null,
                    uploadedByName: image.uploadedByName ?? user?.name ?? user?.email ?? null,
                });

                setArticleImages((prev) =>
                    prev.map((item) =>
                        item.id === recordId
                            ? {
                                ...item,
                                linkedArticleIds: image.linkedArticleIds ?? [],
                                uploadedBy: image.uploadedBy ?? user?.id ?? null,
                                uploadedByName: image.uploadedByName ?? user?.name ?? user?.email ?? null,
                            }
                            : item
                    )
                );
                setLibraryImages((prev) =>
                    prev.map((item) =>
                        item.id === recordId
                            ? {
                                ...item,
                                linkedArticleIds: image.linkedArticleIds ?? [],
                                uploadedBy: image.uploadedBy ?? user?.id ?? null,
                                uploadedByName: image.uploadedByName ?? user?.name ?? user?.email ?? null,
                            }
                            : item
                    )
                );
            }

            if (!options.suppressToast) {
                setSuccessMessage('Image details saved.');
            }
        } catch (error: any) {
            setFailureMessage(error?.message || 'Failed to save image details.');
        } finally {
            setImageSavingState(savingKey, false);
        }
    };

    const linkImageToCurrentArticle = async (
        record: ImageRecord,
        options: {silent?: boolean} = {}
    ) => {
        if (!articleId) {
            return;
        }

        const existingLinks = Array.isArray(record.linkedArticleIds) ? record.linkedArticleIds : [];
        const hasLink = existingLinks.includes(articleId);
        const updatedLinks = hasLink ? existingLinks : [...existingLinks, articleId];
        const updatedRecord: ImageRecord = {
            ...record,
            linkedArticleIds: updatedLinks,
            lastUsedAt: new Date(),
        };

        upsertArticleImage(updatedRecord);
        upsertLibraryImage(updatedRecord);

        try {
            if (record.id.startsWith('temp-')) {
                await handleSaveMetadata(record.id, {
                    suppressToast: true,
                    recordOverride: updatedRecord,
                });
                return;
            }

            const updatePayload: Record<string, unknown> = {
                lastUsedAt: serverTimestamp(),
            };

            if (!hasLink) {
                updatePayload.linkedArticleIds = updatedLinks;
            }

            await updateDoc(doc(db, 'images', record.id), updatePayload);
        } catch (error: any) {
            if (!options.silent) {
                setFailureMessage(error?.message || 'Unable to link image to this article.');
            }
        }
    };

    const unlinkImageFromCurrentArticle = async (record: ImageRecord) => {
        if (!articleId) {
            return;
        }

        const existingLinks = Array.isArray(record.linkedArticleIds) ? record.linkedArticleIds : [];
        if (!existingLinks.includes(articleId)) {
            return;
        }

        const updatedLinks = existingLinks.filter((id) => id !== articleId);
        const previousArticleImages = articleImages;
        const previousLibraryImages = libraryImages;

        setArticleImages((prev) => prev.filter((item) => item.id !== record.id));
        setLibraryImages((prev) =>
            prev.map((item) => (item.id === record.id ? {...item, linkedArticleIds: updatedLinks} : item))
        );

        try {
            if (record.id.startsWith('temp-')) {
                setSuccessMessage('Image detached from this article.');
                return;
            }

            const updatePayload: Record<string, unknown> = {
                linkedArticleIds: arrayRemove(articleId),
            };

            if (updatedLinks.length === 0) {
                updatePayload.lastUsedAt = null;
            }

            await updateDoc(doc(db, 'images', record.id), updatePayload);
            setSuccessMessage('Image detached from this article.');
        } catch (error: any) {
            setFailureMessage(error?.message || 'Unable to detach image from this article.');
            setArticleImages(previousArticleImages);
            setLibraryImages(previousLibraryImages);
        }
    };

    const fetchLibraryImages = async () => {
        setIsLoadingLibrary(true);
        try {
            const imagesRef = collection(db, 'images');
            const libraryQuery = query(imagesRef, orderBy('createdAt', 'desc'), limit(MAX_LIBRARY_IMAGES));
            const snapshot = await getDocs(libraryQuery);
            const records: ImageRecord[] = snapshot.docs.map(mapDocToImageRecord);
            setLibraryImages((prev) => {
                const combinedMap = new Map<string, ImageRecord>();
                prev.forEach((item) => {
                    combinedMap.set(item.id, item);
                });
                records.forEach((item) => {
                    const existing = combinedMap.get(item.id);
                    combinedMap.set(item.id, existing ? {...existing, ...item} : item);
                });
                const combined = Array.from(combinedMap.values());
                combined.sort((a, b) => {
                    const timeA = a.createdAt ? a.createdAt.getTime() : 0;
                    const timeB = b.createdAt ? b.createdAt.getTime() : 0;
                    return timeB - timeA;
                });
                return combined.slice(0, MAX_LIBRARY_IMAGES);
            });
        } catch (error: any) {
            setFailureMessage(error?.message || 'Unable to load the image library.');
        } finally {
            setIsLoadingLibrary(false);
        }
    };

    const handleOpenLibrary = async () => {
        setIsLibraryOpen(true);
        await fetchLibraryImages();
    };

    const handleCloseLibrary = () => {
        setIsLibraryOpen(false);
    };

    const handleCopyLink = async (url: string) => {
        try {
            if (!navigator?.clipboard) {
                throw new Error('Clipboard access is not available in this browser.');
            }
            await navigator.clipboard.writeText(url);
            setSuccessMessage('Image link copied to clipboard.');
        } catch (error: any) {
            setFailureMessage(error?.message || 'Could not copy image link.');
        }
    };

    const handleSetFeatured = (image: ImageRecord) => {
        onSetFeatured(image.url);
        linkImageToCurrentArticle(image, {silent: false});
        setSuccessMessage('Featured image updated.');
    };

    const handleInsert = (image: ImageRecord) => {
        onInsertIntoMarkdown(image.url);
        linkImageToCurrentArticle(image, {silent: true});
        setSuccessMessage('Image markdown inserted.');
    };

    const getDisplayUrl = (url: string) => {
        if (url.length <= 60) {
            return url;
        }
        return `${url.slice(0, 30)}…${url.slice(-20)}`;
    };

    return (
        <>
            <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h3 className="text-sm font-semibold text-slate-800">Image Uploads</h3>
                    <p className="text-xs text-slate-500">
                        Upload an image once and reuse the generated link wherever you need it.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFilesSelected}
                    />
                    <button
                        type="button"
                        onClick={handleChooseFile}
                        className="rounded-md border border-indigo-200 bg-white px-3 py-1.5 text-sm font-medium text-indigo-600 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50"
                        disabled={isUploading}
                    >
                        {isUploading ? 'Uploading…' : 'Upload Image'}
                    </button>
                    <button
                        type="button"
                        onClick={handleOpenLibrary}
                        className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isLoadingLibrary}
                    >
                        {isLoadingLibrary ? 'Loading…' : 'Open Library'}
                    </button>
                </div>
            </div>

            {isUploading && (
                <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-slate-600">
                        <span>Uploading</span>
                        <span>{uploadProgress}%</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded bg-slate-200">
                        <div
                            className="h-full rounded bg-indigo-500 transition-all"
                            style={{width: `${uploadProgress}%`}}
                        />
                    </div>
                </div>
            )}

            {(statusMessage || errorMessage) && (
                <p className={`mt-3 text-xs ${errorMessage ? 'text-red-600' : 'text-green-600'}`}>
                    {errorMessage ?? statusMessage}
                </p>
            )}

            {!articleId && (
                <p className="mt-4 text-xs text-amber-600">
                    Add a title and date so uploaded images can be linked to this article automatically.
                </p>
            )}

            {isLoadingArticleImages && articleImages.length === 0 && (
                <p className="mt-4 text-xs text-slate-500">Loading previously uploaded images…</p>
            )}

            {!isLoadingArticleImages && articleImages.length === 0 && (
                <p className="mt-4 text-xs text-slate-500">
                    Images linked to this article will appear here. Upload a new file or open the
                    library to attach an existing image.
                </p>
            )}

            {articleImages.length > 0 && (
                <div className="mt-4 space-y-3">
                    {articleImages.map((image) => {
                        const savingKey = image.storagePath || image.id;
                        const isSavingMetadata = Boolean(savingState[savingKey]);

                        return (
                            <div
                                key={image.id}
                                className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
                            >
                                <div className="flex items-start gap-3">
                                    <div className="h-16 w-16 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                                        <img
                                            src={image.url}
                                            alt={image.altText || 'Uploaded preview'}
                                            className="h-full w-full object-cover"
                                        />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p
                                            className="truncate text-sm font-semibold text-slate-800"
                                            title={image.fileName}
                                        >
                                            {image.fileName}
                                        </p>
                                        <p
                                            className="truncate text-[0.7rem] text-slate-500"
                                            title={image.url}
                                        >
                                            {getDisplayUrl(image.url)}
                                        </p>
                                        {image.uploadedByName && (
                                            <p className="text-[0.65rem] uppercase tracking-wide text-slate-400">
                                                Uploaded by {image.uploadedByName}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <div className="grid gap-2 sm:grid-cols-2">
                                    <label className="flex flex-col gap-1">
                                        <span className="text-[0.65rem] font-medium uppercase text-slate-500">
                                            Credit / Author
                                        </span>
                                        <input
                                            type="text"
                                            value={image.credit}
                                            onChange={(event) =>
                                                handleMetadataFieldChange(image.id, 'credit', event.target.value)
                                            }
                                            className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                            placeholder="Who shot or provided this image?"
                                        />
                                    </label>

                                    <label className="flex flex-col gap-1">
                                        <span className="text-[0.65rem] font-medium uppercase text-slate-500">
                                            Caption
                                        </span>
                                        <textarea
                                            value={image.caption}
                                            rows={2}
                                            onChange={(event) =>
                                                handleMetadataFieldChange(image.id, 'caption', event.target.value)
                                            }
                                            className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                            placeholder="Context for the photo."
                                        />
                                    </label>

                                    <label className="flex flex-col gap-1 sm:col-span-2">
                                        <span className="text-[0.65rem] font-medium uppercase text-slate-500">
                                            Alt Text
                                        </span>
                                        <textarea
                                            value={image.altText}
                                            rows={2}
                                            onChange={(event) =>
                                                handleMetadataFieldChange(image.id, 'altText', event.target.value)
                                            }
                                            className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                            placeholder="Short description for screen readers."
                                        />
                                    </label>
                                </div>

                                <div className="flex flex-wrap gap-2 pt-1">
                                    <button
                                        type="button"
                                        onClick={() => handleCopyLink(image.url)}
                                        className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                                    >
                                        Copy Link
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleSetFeatured(image)}
                                        className="rounded-md border border-amber-200 px-2.5 py-1 text-xs font-medium text-amber-700 transition hover:border-amber-300 hover:bg-amber-50"
                                    >
                                        Use as Featured
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleInsert(image)}
                                        className="rounded-md border border-indigo-200 px-2.5 py-1 text-xs font-medium text-indigo-600 transition hover:border-indigo-300 hover:bg-indigo-50"
                                    >
                                        Insert Markdown
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleSaveMetadata(image.id)}
                                        disabled={isSavingMetadata}
                                        className="rounded-md border border-emerald-200 px-2.5 py-1 text-xs font-medium text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {isSavingMetadata ? 'Saving…' : 'Save Details'}
                                    </button>
                                    {articleId && (
                                        <button
                                            type="button"
                                            onClick={() => unlinkImageFromCurrentArticle(image)}
                                            className="rounded-md border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-600 transition hover:border-rose-300 hover:bg-rose-50"
                                        >
                                            Detach from Article
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            </div>
            {isLibraryOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
                    <div
                        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
                        onClick={handleCloseLibrary}
                    />
                    <div className="relative z-10 flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
                        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
                            <div>
                                <h4 className="text-base font-semibold text-slate-800">Image Library</h4>
                                <p className="text-xs text-slate-500">
                                    Browse previously uploaded images. Actions will automatically link them
                                    to this article.
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={fetchLibraryImages}
                                    className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    disabled={isLoadingLibrary}
                                >
                                    Refresh
                                </button>
                                <button
                                    type="button"
                                    onClick={handleCloseLibrary}
                                    className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto px-6 py-4">
                            {isLoadingLibrary ? (
                                <p className="text-xs text-slate-500">Loading library…</p>
                            ) : libraryImages.length === 0 ? (
                                <p className="text-xs text-slate-500">
                                    No images found yet. Upload a new image to get started.
                                </p>
                            ) : (
                                <div className="grid gap-3 sm:grid-cols-2">
                                    {libraryImages.map((image) => {
                                        const usageCount = image.linkedArticleIds?.length ?? 0;
                                        const isLinkedToCurrentArticle =
                                            Boolean(articleId) &&
                                            Array.isArray(image.linkedArticleIds) &&
                                            image.linkedArticleIds.includes(articleId);
                                        return (
                                            <div
                                                key={image.id}
                                                className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 shadow-sm"
                                            >
                                                <div className="flex items-start gap-3">
                                                    <div className="h-16 w-16 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                                                        <img
                                                            src={image.url}
                                                            alt={image.altText || 'Uploaded preview'}
                                                            className="h-full w-full object-cover"
                                                        />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <p
                                                            className="truncate text-sm font-semibold text-slate-800"
                                                            title={image.fileName}
                                                        >
                                                            {image.fileName}
                                                        </p>
                                                        <p
                                                            className="truncate text-[0.7rem] text-slate-500"
                                                            title={image.url}
                                                        >
                                                            {getDisplayUrl(image.url)}
                                                        </p>
                                                        <p className="text-[0.65rem] uppercase tracking-wide text-slate-400">
                                                            {usageCount > 0
                                                                ? `Used in ${usageCount} article${usageCount === 1 ? '' : 's'}`
                                                                : 'Not linked to an article yet'}
                                                        </p>
                                                    </div>
                                                </div>
                                                {image.caption && (
                                                    <p className="text-xs text-slate-600">{image.caption}</p>
                                                )}
                                                <div className="flex flex-wrap gap-2 pt-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleCopyLink(image.url)}
                                                        className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                                                    >
                                                        Copy Link
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSetFeatured(image)}
                                                        className="rounded-md border border-amber-200 px-2.5 py-1 text-xs font-medium text-amber-700 transition hover:border-amber-300 hover:bg-amber-50"
                                                    >
                                                        Use as Featured
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleInsert(image)}
                                                        className="rounded-md border border-indigo-200 px-2.5 py-1 text-xs font-medium text-indigo-600 transition hover:border-indigo-300 hover:bg-indigo-50"
                                                    >
                                                        Insert Markdown
                                                    </button>
                                                    {articleId && !isLinkedToCurrentArticle && (
                                                        <button
                                                            type="button"
                                                            onClick={async () => {
                                                                await linkImageToCurrentArticle(image, {silent: false});
                                                                setSuccessMessage('Image linked to this article.');
                                                            }}
                                                            className="rounded-md border border-emerald-200 px-2.5 py-1 text-xs font-medium text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-50"
                                                        >
                                                            Attach to Article
                                                        </button>
                                                    )}
                                                    {articleId && isLinkedToCurrentArticle && (
                                                            <button
                                                                type="button"
                                                                onClick={() => unlinkImageFromCurrentArticle(image)}
                                                                className="rounded-md border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-600 transition hover:border-rose-300 hover:bg-rose-50"
                                                            >
                                                                Detach from Article
                                                            </button>
                                                        )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
