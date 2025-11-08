import {ChangeEvent, useCallback, useEffect, useRef, useState} from 'react';
import {getApp} from 'firebase/app';
import {getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject} from 'firebase/storage';
import {
    addDoc,
    arrayRemove,
    collection,
    deleteDoc,
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

interface FeaturedImageSelection {
    id: string;
    url: string;
    credit?: string;
    altText?: string;
    caption?: string;
    storagePath?: string;
}

interface ImageUploadAssistantProps {
    onSetFeatured: (image: FeaturedImageSelection) => void;
    onInsertIntoMarkdown: (value: string) => void;
    onImageRecordUpdate?: (image: ImageRecord) => void;
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
const MAX_IMAGE_DIMENSION = 2000; // px, large enough for full-width display
const DEFAULT_EXPORT_QUALITY = 0.9;
const PREFERRED_EXPORT_TYPE = 'image/webp';
const FALLBACK_EXPORT_TYPE = 'image/jpeg';

const createObjectPath = (file: File) => {
    const sanitizedName = file.name.replace(/\s+/g, '-').toLowerCase();
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return `article-images/${uniqueSuffix}-${sanitizedName}`;
};

const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });

const loadImageFromUrl = (url: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
    });

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
    new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob), type, quality);
    });

const getOptimizedFileName = (fileName: string, extension: string) => {
    const normalizedExtension = extension.startsWith('.') ? extension : `.${extension}`;
    if (!fileName) {
        return `image${normalizedExtension}`;
    }
    const base = fileName.includes('.') ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName;
    return `${base}${normalizedExtension}`;
};

const convertFileForUpload = async (file: File): Promise<File | null> => {
    if (typeof window === 'undefined') {
        return null;
    }
    try {
        const dataUrl = await readFileAsDataUrl(file);
        const image = await loadImageFromUrl(dataUrl);
        const {width, height} = image;
        if (!width || !height) {
            return null;
        }
        const maxDimension = Math.max(width, height);
        const scale = maxDimension > MAX_IMAGE_DIMENSION ? MAX_IMAGE_DIMENSION / maxDimension : 1;
        const targetWidth = Math.round(width * scale);
        const targetHeight = Math.round(height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext('2d');
        if (!context) {
            return null;
        }
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, targetWidth, targetHeight);

        const preferredBlob = await canvasToBlob(canvas, PREFERRED_EXPORT_TYPE, DEFAULT_EXPORT_QUALITY);
        let blob = preferredBlob;
        let extension = '.webp';
        let mimeType = PREFERRED_EXPORT_TYPE;

        if (!blob) {
            blob = await canvasToBlob(canvas, FALLBACK_EXPORT_TYPE, DEFAULT_EXPORT_QUALITY);
            extension = '.jpg';
            mimeType = FALLBACK_EXPORT_TYPE;
        }

        if (!blob) {
            return null;
        }

        return new File([blob], getOptimizedFileName(file.name, extension), {type: mimeType});
    } catch (error) {
        console.error('convertFileForUpload failed', error);
        return null;
    }
};

export default function ImageUploadAssistant({
                                                 onSetFeatured,
                                                 onInsertIntoMarkdown,
                                                 onImageRecordUpdate,
                                                 articleId = null,
                                             }: ImageUploadAssistantProps) {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const {user} = useUser();
    const [articleImages, setArticleImages] = useState<ImageRecord[]>([]);
    const [libraryImages, setLibraryImages] = useState<ImageRecord[]>([]);
    const articleImagesRef = useRef(articleImages);
    const libraryImagesRef = useRef(libraryImages);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isLoadingArticleImages, setIsLoadingArticleImages] = useState<boolean>(true);
    const [isLibraryOpen, setIsLibraryOpen] = useState(false);
    const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
    const [savingState, setSavingState] = useState<Record<string, boolean>>({});
    const metadataSaveTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

    useEffect(() => {
        articleImagesRef.current = articleImages;
    }, [articleImages]);

    useEffect(() => {
        libraryImagesRef.current = libraryImages;
    }, [libraryImages]);

    useEffect(() => {
        return () => {
            metadataSaveTimersRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
            metadataSaveTimersRef.current.clear();
        };
    }, []);

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

    const notifyImageRecord = useCallback(
        (record: ImageRecord) => {
            if (typeof onImageRecordUpdate === 'function' && record?.id) {
                onImageRecordUpdate(record);
            }
        },
        [onImageRecordUpdate]
    );

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
        notifyImageRecord(record);
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
        notifyImageRecord(record);
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
                records.forEach(notifyImageRecord);
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

    const handleFilesSelected = async (event: ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) {
            return;
        }
        const [firstFile] = files;
        if (!firstFile) {
            return;
        }
        try {
            // Currently handle only the first file; users can upload again for more.
            await uploadFile(firstFile);
        } catch (error) {
            console.error('Unexpected upload error', error);
            setFailureMessage(error instanceof Error ? error.message : 'Unable to upload image.');
            setIsUploading(false);
        } finally {
            event.target.value = '';
        }
    };

    const uploadFile = async (file: File) => {
        setIsUploading(true);
        setUploadProgress(0);
        setFailureMessage(null);
        setSuccessMessage(null);

        const optimizedFile = await convertFileForUpload(file);
        const isLikelyHeic =
            /heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
        if (!optimizedFile && isLikelyHeic) {
            setIsUploading(false);
            setFailureMessage('This browser cannot process HEIC images. Please convert to JPG or PNG and try again.');
            return;
        }

        const fileToUpload = optimizedFile ?? file;
        const storagePath = createObjectPath(fileToUpload);
        const storageRef = ref(storage, storagePath);
        const uploadTask = uploadBytesResumable(storageRef, fileToUpload);

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
                        fileName: fileToUpload.name,
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
                            fileName: fileToUpload.name,
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

    const handleSaveMetadata = useCallback(async (
        recordId: string,
        options: {suppressToast?: boolean; recordOverride?: ImageRecord} = {}
    ) => {
        if (metadataSaveTimersRef.current.has(recordId)) {
            const timeoutId = metadataSaveTimersRef.current.get(recordId);
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            metadataSaveTimersRef.current.delete(recordId);
        }
        const image =
            (options.recordOverride ??
            articleImagesRef.current.find((item) => item.id === recordId)) ||
            libraryImagesRef.current.find((item) => item.id === recordId);
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
    }, [articleId, user]);

    const scheduleMetadataSave = useCallback((recordId: string) => {
        if (!recordId || typeof window === 'undefined') {
            return;
        }
        const existing = metadataSaveTimersRef.current.get(recordId);
        if (existing) {
            clearTimeout(existing);
        }
        const timeoutId = window.setTimeout(() => {
            metadataSaveTimersRef.current.delete(recordId);
            handleSaveMetadata(recordId, {suppressToast: true});
        }, 800);
        metadataSaveTimersRef.current.set(recordId, timeoutId);
    }, [handleSaveMetadata]);

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
        scheduleMetadataSave(id);
    };

    const linkImageToCurrentArticle = async (
        record: ImageRecord,
        options: {silent?: boolean} = {}
    ): Promise<boolean> => {
        if (!articleId) {
            return false;
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
                return true;
            }

            const updatePayload: Record<string, unknown> = {
                lastUsedAt: serverTimestamp(),
            };

            if (!hasLink) {
                updatePayload.linkedArticleIds = updatedLinks;
            }

            await updateDoc(doc(db, 'images', record.id), updatePayload);
            return true;
        } catch (error: any) {
            if (!options.silent) {
                setFailureMessage(error?.message || 'Unable to link image to this article.');
            }
            return false;
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

    const handleDeleteImage = async (record: ImageRecord) => {
        if (!record) {
            return;
        }
        const confirmed = window.confirm('Delete this image from the library? This cannot be undone.');
        if (!confirmed) {
            return;
        }

        const storageKey = record.storagePath || record.id;
        const previousArticleImages = articleImages;
        const previousLibraryImages = libraryImages;

        setStatusMessage(null);
        setErrorMessage(null);
        setImageSavingState(storageKey, true);
        setArticleImages((prev) => prev.filter((item) => item.id !== record.id));
        setLibraryImages((prev) => prev.filter((item) => item.id !== record.id));

        try {
            if (!record.id.startsWith('temp-')) {
                await deleteDoc(doc(db, 'images', record.id));
            }
            if (record.storagePath) {
                try {
                    await deleteObject(ref(storage, record.storagePath));
                } catch (storageError) {
                    console.error('Failed to delete storage object for image', record.storagePath, storageError);
                }
            }
            setSuccessMessage('Image deleted.');
        } catch (error: any) {
            setFailureMessage(error?.message || 'Unable to delete image.');
            setArticleImages(previousArticleImages);
            setLibraryImages(previousLibraryImages);
        } finally {
            setImageSavingState(storageKey, false);
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
            records.forEach(notifyImageRecord);
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

    const handleSetFeatured = async (image: ImageRecord) => {
        onSetFeatured({
            id: image.id,
            url: image.url,
            credit: image.credit,
            altText: image.altText,
            caption: image.caption,
            storagePath: image.storagePath,
        });
        const wasLinked = await linkImageToCurrentArticle(image, {silent: false});
        if (wasLinked) {
            setSuccessMessage('Featured image updated and linked to this article.');
        } else if (!articleId) {
            setFailureMessage('Featured image updated, but add a title and publish date to link it to this article.');
        }
    };

    const buildFigureToken = (image?: ImageRecord | null) =>
        image?.id ? `{{image:${image.id}}}` : '';

    const handleCopyFigureToken = async (image: ImageRecord) => {
        try {
            const token = buildFigureToken(image);
            if (!token) {
                throw new Error('No figure token available yet.');
            }
            if (!navigator?.clipboard) {
                throw new Error('Clipboard access is not available in this browser.');
            }
            await navigator.clipboard.writeText(token);
            setSuccessMessage('Figure token copied. Paste it into the article body.');
        } catch (error: any) {
            setFailureMessage(error?.message || 'Unable to copy figure token.');
        }
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
                        const isImageBusy = Boolean(savingState[savingKey]);

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
                                <div className="flex flex-wrap items-center gap-2 pt-1">
                                    <span className="rounded bg-slate-100 px-2 py-0.5 text-[0.65rem] font-mono text-slate-600">
                                        {buildFigureToken(image)}
                                    </span>
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
                                        onClick={() => handleCopyFigureToken(image)}
                                        className="rounded-md border border-blue-200 px-2.5 py-1 text-xs font-medium text-blue-600 transition hover:border-blue-300 hover:bg-blue-50"
                                    >
                                        Copy Figure
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
                                    <button
                                        type="button"
                                        onClick={() => handleDeleteImage(image)}
                                        disabled={isImageBusy}
                                        className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 transition hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        Delete
                                    </button>
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
                                    Browse previously uploaded images. Actions link them to this article once a title and publish date are set.
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
                                        const savingKey = image.storagePath || image.id;
                                        const isImageBusy = Boolean(savingState[savingKey]);
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
                                                <div className="flex flex-wrap items-center gap-2 pt-1">
                                                    <span className="rounded bg-slate-100 px-2 py-0.5 text-[0.65rem] font-mono text-slate-600">
                                                        {buildFigureToken(image)}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleCopyLink(image.url)}
                                                        className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                                                    >
                                                        Copy Link
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleCopyFigureToken(image)}
                                                        className="rounded-md border border-blue-200 px-2.5 py-1 text-xs font-medium text-blue-600 transition hover:border-blue-300 hover:bg-blue-50"
                                                    >
                                                        Copy Figure
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSetFeatured(image)}
                                                        className="rounded-md border border-amber-200 px-2.5 py-1 text-xs font-medium text-amber-700 transition hover:border-amber-300 hover:bg-amber-50"
                                                    >
                                                        Use as Featured
                                                    </button>
                                                    {articleId ? (
                                                        isLinkedToCurrentArticle ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => unlinkImageFromCurrentArticle(image)}
                                                                className="rounded-md border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-600 transition hover:border-rose-300 hover:bg-rose-50"
                                                            >
                                                                Detach from Article
                                                            </button>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                onClick={async () => {
                                                                    const wasLinked = await linkImageToCurrentArticle(image, {silent: false});
                                                                    if (wasLinked) {
                                                                        setSuccessMessage('Image linked to this article.');
                                                                    }
                                                                }}
                                                                className="rounded-md border border-emerald-200 px-2.5 py-1 text-xs font-medium text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-50"
                                                            >
                                                                Link to Article
                                                            </button>
                                                        )
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            disabled
                                                            title="Add a title and publish date to enable linking."
                                                            className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-400 transition"
                                                        >
                                                            Link to Article
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteImage(image)}
                                                        disabled={isImageBusy}
                                                        className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 transition hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                                                    >
                                                        Delete
                                                    </button>
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
