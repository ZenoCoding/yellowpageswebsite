import {useEffect, useMemo, useState} from 'react';
import {getApp} from 'firebase/app';
import {getAuth, GoogleAuthProvider, reauthenticateWithPopup} from 'firebase/auth';
import {addDoc, collection, getFirestore, serverTimestamp} from 'firebase/firestore';
import {getDownloadURL, getStorage, ref, uploadBytes} from 'firebase/storage';
import {CheckCircleIcon, PhotoIcon} from '@heroicons/react/24/outline';
import {useUser} from '../firebase/useUser';

interface ImportedMediaItem {
    key: string;
    sourceId: string;
    sourceName: string;
    sourceKind: 'drive_file' | 'doc_inline';
    mimeType: string;
    previewUrl: string;
    fetchUrl: string;
    role: 'unused' | 'featured' | 'inline';
    insertAfterParagraph?: number | null;
    caption: string;
    altText: string;
    credit: string;
    sourceUrl?: string;
    sourceTitle?: string;
    sourceLookupStatus?: 'found' | 'not_found' | 'unavailable' | 'not_run';
    rightsStatus: 'unreviewed' | 'original' | 'licensed' | 'permission' | 'web_source' | 'source_not_found' | 'unknown';
    aiVisuallyAnalyzed: boolean;
    aiWarning: string;
    importedImageId: string;
}

interface ImportedMediaPanelProps {
    items: ImportedMediaItem[];
    articleId?: string | null;
    onItemsChange: (items: ImportedMediaItem[]) => void;
    onSetFeatured: (image: Record<string, string>) => void;
    onInsertIntoMarkdown: (value: string, placement?: {
        automaticPlacement?: boolean;
        insertAfterParagraph?: number | null;
        sequenceIndex?: number;
        sequenceCount?: number;
    }) => void;
    onImageRecordUpdate?: (image: Record<string, unknown>) => void;
}

const DRIVE_TOKEN_STORAGE_KEY = 'yellowpages-drive-readonly-token-v1';
const DRIVE_TOKEN_LIFETIME_MS = 50 * 60 * 1000;

const readDriveToken = () => {
    try {
        const cached = JSON.parse(window.sessionStorage.getItem(DRIVE_TOKEN_STORAGE_KEY) || 'null');
        if (cached?.accessToken && cached?.expiresAt > Date.now()) return cached.accessToken;
        window.sessionStorage.removeItem(DRIVE_TOKEN_STORAGE_KEY);
        return null;
    } catch {
        window.sessionStorage.removeItem(DRIVE_TOKEN_STORAGE_KEY);
        return null;
    }
};

const authorizeDrive = async () => {
    const firebaseUser = getAuth().currentUser;
    if (!firebaseUser) throw new Error('Your sign-in expired. Sign in again and retry the image.');
    const provider = new GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/drive.readonly');
    provider.setCustomParameters({login_hint: firebaseUser.email || ''});
    const result = await reauthenticateWithPopup(firebaseUser, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) throw new Error('Google did not return Drive access. Please retry.');
    window.sessionStorage.setItem(DRIVE_TOKEN_STORAGE_KEY, JSON.stringify({
        accessToken: credential.accessToken,
        expiresAt: Date.now() + DRIVE_TOKEN_LIFETIME_MS,
    }));
    return credential.accessToken;
};

const downloadDriveSource = async (url: string) => {
    let accessToken = readDriveToken() || await authorizeDrive();
    let response = await fetch(url, {headers: {Authorization: `Bearer ${accessToken}`}});
    if (response.status === 401) {
        window.sessionStorage.removeItem(DRIVE_TOKEN_STORAGE_KEY);
        accessToken = await authorizeDrive();
        response = await fetch(url, {headers: {Authorization: `Bearer ${accessToken}`}});
    }
    return response;
};

const loadImage = (url: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('This image format could not be decoded.'));
        image.src = url;
    });

const optimizeImage = async (blob: Blob, fileName: string) => {
    const objectUrl = URL.createObjectURL(blob);
    try {
        const image = await loadImage(objectUrl);
        const scale = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Image conversion is unavailable in this browser.');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const optimizedBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
        if (!optimizedBlob) throw new Error('Image conversion failed.');
        const baseName = fileName.includes('.') ? fileName.slice(0, fileName.lastIndexOf('.')) : fileName;
        return new File([optimizedBlob], `${baseName || 'article-image'}.webp`, {type: 'image/webp'});
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
};

export default function ImportedMediaPanel({
    items,
    articleId,
    onItemsChange,
    onSetFeatured,
    onInsertIntoMarkdown,
    onImageRecordUpdate,
}: ImportedMediaPanelProps) {
    const {user} = useUser();
    const [busyKey, setBusyKey] = useState<string | null>(null);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [expandedKey, setExpandedKey] = useState<string | null>(null);
    const selectedItems = useMemo(() => items.filter((item) => item.role !== 'unused'), [items]);

    useEffect(() => {
        setMessage('');
        setError('');
    }, [articleId]);

    if (!items.length) return null;

    const updateItem = (key: string, update: Partial<ImportedMediaItem>) => {
        onItemsChange(items.map((item) => item.key === key ? {...item, ...update} : item));
    };

    const importImage = async (item: ImportedMediaItem) => {
        setError('');
        setMessage('');
        if (!articleId) {
            setError('Add a title and publication date before importing source images.');
            return;
        }
        if (item.role === 'unused') {
            setError('Choose Featured or Inline before importing this image.');
            return;
        }
        if (!item.altText.trim()) {
            setError('Add and verify accessibility alt text before importing this image.');
            return;
        }
        if (['unreviewed', 'unknown'].includes(item.rightsStatus)) {
            setError('Confirm who owns this image or that permission/license exists before importing it.');
            return;
        }
        setBusyKey(item.key);
        try {
            const downloadUrl = item.sourceKind === 'drive_file'
                ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.sourceId)}?alt=media`
                : item.fetchUrl;
            const sourceResponse = await downloadDriveSource(downloadUrl);
            if (!sourceResponse.ok) throw new Error(`Drive image download failed (${sourceResponse.status}).`);
            const optimizedFile = await optimizeImage(await sourceResponse.blob(), item.sourceName);
            const safeName = optimizedFile.name.replace(/\s+/g, '-').toLowerCase();
            const storagePath = `article-images/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
            const storage = getStorage(getApp());
            const storageRef = ref(storage, storagePath);
            await uploadBytes(storageRef, optimizedFile);
            const url = await getDownloadURL(storageRef);
            const db = getFirestore(getApp());
            const record = {
                url,
                storagePath,
                fileName: optimizedFile.name,
                caption: item.caption.trim(),
                credit: item.credit.trim(),
                creditType: item.sourceUrl ? 'source' : 'photographer',
                sourceUrl: item.sourceUrl || null,
                sourceTitle: item.sourceTitle || null,
                altText: item.altText.trim(),
                linkedArticleIds: [articleId],
                uploadedBy: user?.id ?? null,
                uploadedByName: user?.name ?? user?.email ?? null,
                createdAt: serverTimestamp(),
                lastUsedAt: serverTimestamp(),
                importSourceId: item.sourceId,
                importSourceKind: item.sourceKind,
                rightsStatus: item.rightsStatus,
            };
            const documentRef = await addDoc(collection(db, 'images'), record);
            const savedRecord = {...record, id: documentRef.id, createdAt: new Date(), lastUsedAt: new Date()};
            onImageRecordUpdate?.(savedRecord);
            if (item.role === 'featured') onSetFeatured({...savedRecord, id: documentRef.id});
            if (item.role === 'inline') {
                const inlineItems = items.filter((candidate) => candidate.role === 'inline');
                onInsertIntoMarkdown(`{{image:${documentRef.id}}}`, {
                    automaticPlacement: true,
                    insertAfterParagraph: item.insertAfterParagraph,
                    sequenceIndex: Math.max(0, inlineItems.findIndex((candidate) => candidate.key === item.key)),
                    sequenceCount: Math.max(1, inlineItems.length),
                });
            }
            updateItem(item.key, {importedImageId: documentRef.id});
            setMessage(`${item.sourceName} imported as ${item.role}.`);
        } catch (importError: any) {
            setError(importError?.message || 'Image import failed.');
        } finally {
            setBusyKey(null);
        }
    };

    return (
        <section className="border border-slate-200 bg-white p-4">
            <div className="flex items-start gap-3">
                <PhotoIcon className="mt-0.5 h-5 w-5 text-slate-700" aria-hidden="true"/>
                <div>
                    <h2 className="text-base font-semibold text-slate-900">Source images</h2>
                </div>
            </div>

            <div className="mt-4 divide-y divide-slate-200 border-y border-slate-200">
                {items.map((item) => (
                    <article key={item.key} className="py-3">
                        <div className="flex items-center gap-3">
                            <div className="h-14 w-16 shrink-0 overflow-hidden bg-slate-100">
                                {item.previewUrl ? (
                                    // Drive and Docs return short-lived URLs that cannot use Next image optimization.
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={item.previewUrl} alt="" className="h-full w-full object-contain" referrerPolicy="no-referrer"/>
                                ) : <div className="flex h-full items-center justify-center text-[10px] text-slate-400">No preview</div>}
                            </div>
                            <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold text-slate-900">{item.sourceName}</h3><p className="mt-0.5 text-xs text-slate-500">{item.importedImageId ? 'Imported' : item.sourceKind === 'doc_inline' ? 'Embedded image' : 'Drive image'}</p></div>
                            <select aria-label={`Use ${item.sourceName} as`} value={item.role} onChange={(event) => updateItem(item.key, {role: event.target.value as ImportedMediaItem['role']})} className="w-32 border border-slate-300 p-2 text-xs">
                                <option value="unused">Do not use</option><option value="featured">Featured</option><option value="inline">Inline</option>
                            </select>
                            {item.importedImageId ? <CheckCircleIcon className="h-5 w-5 shrink-0 text-emerald-600"/> : <button type="button" onClick={() => setExpandedKey((current) => current === item.key ? null : item.key)} className="text-xs font-bold text-slate-700 underline">{expandedKey === item.key ? 'Close' : 'Details'}</button>}
                        </div>
                        {expandedKey === item.key && !item.importedImageId && <div className="ml-[4.75rem] mt-3 border-t border-slate-100 pt-3">
                                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                    <label className="text-xs font-medium text-slate-700">Rights/source status
                                        <select value={item.rightsStatus} onChange={(event) => updateItem(item.key, {rightsStatus: event.target.value as ImportedMediaItem['rightsStatus']})} className="mt-1 block w-full rounded-md border border-slate-300 p-2 text-sm">
                                            <option value="unreviewed">Not reviewed</option><option value="original">Original staff photo/art</option><option value="permission">Permission confirmed</option><option value="licensed">License/public-domain confirmed</option><option value="web_source">Web source found</option><option value="source_not_found">Source not found</option><option value="unknown">Unknown</option>
                                        </select>
                                    </label>
                                    <label className="text-xs font-medium text-slate-700 sm:col-span-2">Alt text
                                        <input value={item.altText} onChange={(event) => updateItem(item.key, {altText: event.target.value})} className="mt-1 block w-full rounded-md border border-slate-300 p-2 text-sm"/>
                                    </label>
                                    <label className="text-xs font-medium text-slate-700">Caption
                                        <input value={item.caption} onChange={(event) => updateItem(item.key, {caption: event.target.value})} className="mt-1 block w-full rounded-md border border-slate-300 p-2 text-sm"/>
                                    </label>
                                    <label className="text-xs font-medium text-slate-700">Credit/source line
                                        <input value={item.credit} onChange={(event) => updateItem(item.key, {credit: event.target.value})} placeholder="Photographer or source" className="mt-1 block w-full rounded-md border border-slate-300 p-2 text-sm"/>
                                    </label>
                                </div>
                                {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 block truncate text-xs font-semibold text-sky-700 hover:underline">Matched source: {item.sourceTitle || item.sourceUrl}</a>}
                                {item.aiWarning && <p className="mt-3 text-xs text-amber-700">{item.aiWarning}</p>}
                                <button type="button" onClick={() => importImage(item)} disabled={busyKey === item.key || Boolean(item.importedImageId) || item.role === 'unused'} className="mt-4 bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
                                    {busyKey === item.key ? 'Importing…' : item.importedImageId ? 'Imported' : `Import as ${item.role}`}
                                </button>
                        </div>}
                    </article>
                ))}
            </div>
            <p className="mt-4 text-xs text-slate-500">{selectedItems.length} selected. Confirm rights and credit before import.</p>
            {message && <p className="mt-3 text-sm text-emerald-700">{message}</p>}
            {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
        </section>
    );
}
