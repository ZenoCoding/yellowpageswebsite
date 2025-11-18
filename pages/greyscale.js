import Head from 'next/head';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import Navbar from '../components/Navbar';

const SUPPORTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/jpg'];
const OUTPUT_TYPE = 'image/jpeg';
const OUTPUT_QUALITY = 0.92;

const formatBytes = (bytes) => {
    if (!Number.isFinite(bytes)) {
        return '0 B';
    }
    if (bytes === 0) {
        return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    const precision = value >= 100 || unitIndex === 0 ? 0 : 1;
    return `${value.toFixed(precision)} ${units[unitIndex]}`;
};

const getConvertedFileName = (originalName) => {
    if (!originalName || typeof originalName !== 'string') {
        return 'converted-greyscale.jpg';
    }
    const lastDot = originalName.lastIndexOf('.');
    const base = lastDot > 0 ? originalName.slice(0, lastDot) : originalName;
    return `${base}-greyscale.jpg`;
};

const createId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `image-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const readFileAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Unable to read file'));
        reader.readAsDataURL(file);
    });

const loadImageElement = (source) =>
    new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Unable to decode image'));
        image.src = typeof source === 'string' ? source : '';
    });

const canvasToBlob = (canvas, type, quality) =>
    new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (!blob) {
                    reject(new Error('Canvas export failed'));
                    return;
                }
                resolve(blob);
            },
            type,
            quality
        );
    });

const convertImageFile = async (file) => {
    if (typeof window === 'undefined') {
        throw new Error('Image conversion is only available in the browser.');
    }
    const dataUrl = await readFileAsDataUrl(file);
    const image = await loadImageElement(dataUrl);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) {
        throw new Error('Image has no measurable dimensions.');
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', {willReadFrequently: true});
    if (!context) {
        throw new Error('Canvas rendering context unavailable.');
    }
    context.drawImage(image, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    const {data} = imageData;
    for (let index = 0; index < data.length; index += 4) {
        const red = data[index];
        const green = data[index + 1];
        const blue = data[index + 2];
        const luminance = Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722);
        data[index] = luminance;
        data[index + 1] = luminance;
        data[index + 2] = luminance;
    }
    context.putImageData(imageData, 0, 0);
    const blob = await canvasToBlob(canvas, OUTPUT_TYPE, OUTPUT_QUALITY);
    const convertedFile = new File([blob], getConvertedFileName(file.name), {
        type: OUTPUT_TYPE,
        lastModified: Date.now(),
    });
    const previewUrl = URL.createObjectURL(blob);
    return {
        convertedFile,
        convertedPreviewUrl: previewUrl,
        width,
        height,
    };
};

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
        let current = index;
        for (let bit = 0; bit < 8; bit += 1) {
            if ((current & 1) === 1) {
                current = 0xedb88320 ^ (current >>> 1);
            } else {
                current >>>= 1;
            }
        }
        table[index] = current >>> 0;
    }
    return table;
})();

const crc32 = (data) => {
    let crc = 0 ^ -1;
    for (let index = 0; index < data.length; index += 1) {
        const byte = data[index];
        crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
    }
    return (crc ^ -1) >>> 0;
};

const getDosDateTime = (timestamp) => {
    const date = new Date(typeof timestamp === 'number' ? timestamp : Date.now());
    const year = Math.max(date.getFullYear(), 1980);
    const dosDate =
        ((year - 1980) << 9) |
        ((date.getMonth() + 1) << 5) |
        date.getDate();
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    return {dosDate, dosTime};
};

const createZipFromFiles = async (files) => {
    if (!Array.isArray(files) || files.length === 0) {
        throw new Error('No files available for download.');
    }
    const encoder = new TextEncoder();
    const entries = [];

    for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const arrayBuffer = await file.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);
        const nameBytes = encoder.encode(file.name || `image-${index + 1}.jpg`);
        const {dosDate, dosTime} = getDosDateTime(file.lastModified);
        entries.push({
            data,
            nameBytes,
            crc: crc32(data),
            dosDate,
            dosTime,
            size: data.length,
        });
    }

    const localChunks = [];
    const centralChunks = [];
    let offset = 0;
    let centralDirectorySize = 0;

    entries.forEach((entry) => {
        const localHeader = new DataView(new ArrayBuffer(30));
        localHeader.setUint32(0, 0x04034b50, true);
        localHeader.setUint16(4, 20, true);
        localHeader.setUint16(6, 0, true);
        localHeader.setUint16(8, 0, true);
        localHeader.setUint16(10, entry.dosTime, true);
        localHeader.setUint16(12, entry.dosDate, true);
        localHeader.setUint32(14, entry.crc, true);
        localHeader.setUint32(18, entry.size, true);
        localHeader.setUint32(22, entry.size, true);
        localHeader.setUint16(26, entry.nameBytes.length, true);
        localHeader.setUint16(28, 0, true);

        const localHeaderBytes = new Uint8Array(localHeader.buffer);
        localChunks.push(localHeaderBytes, entry.nameBytes, entry.data);

        const centralHeader = new DataView(new ArrayBuffer(46));
        centralHeader.setUint32(0, 0x02014b50, true);
        centralHeader.setUint16(4, 20, true);
        centralHeader.setUint16(6, 20, true);
        centralHeader.setUint16(8, 0, true);
        centralHeader.setUint16(10, 0, true);
        centralHeader.setUint16(12, entry.dosTime, true);
        centralHeader.setUint16(14, entry.dosDate, true);
        centralHeader.setUint32(16, entry.crc, true);
        centralHeader.setUint32(20, entry.size, true);
        centralHeader.setUint32(24, entry.size, true);
        centralHeader.setUint16(28, entry.nameBytes.length, true);
        centralHeader.setUint16(30, 0, true);
        centralHeader.setUint16(32, 0, true);
        centralHeader.setUint16(34, 0, true);
        centralHeader.setUint16(36, 0, true);
        centralHeader.setUint32(38, 0, true);
        centralHeader.setUint32(42, offset, true);

        const centralHeaderBytes = new Uint8Array(centralHeader.buffer);
        centralChunks.push(centralHeaderBytes, entry.nameBytes);
        centralDirectorySize += centralHeaderBytes.length + entry.nameBytes.length;

        offset += localHeaderBytes.length + entry.nameBytes.length + entry.data.length;
    });

    const endRecord = new DataView(new ArrayBuffer(22));
    endRecord.setUint32(0, 0x06054b50, true);
    endRecord.setUint16(4, 0, true);
    endRecord.setUint16(6, 0, true);
    endRecord.setUint16(8, entries.length, true);
    endRecord.setUint16(10, entries.length, true);
    endRecord.setUint32(12, centralDirectorySize, true);
    endRecord.setUint32(16, offset, true);
    endRecord.setUint16(20, 0, true);

    const zipBlob = new Blob([...localChunks, ...centralChunks, new Uint8Array(endRecord.buffer)], {
        type: 'application/zip',
    });
    return zipBlob;
};

export default function GreyscaleToolPage() {
    const [items, setItems] = useState([]);
    const [isDragging, setIsDragging] = useState(false);
    const [uploadMessage, setUploadMessage] = useState('');
    const [isBatchDownloading, setIsBatchDownloading] = useState(false);
    const fileInputRef = useRef(null);
    const previousItemsRef = useRef([]);

    const totalItems = items.length;
    const readyItems = useMemo(() => items.filter((item) => item.status === 'ready'), [items]);
    const errorItems = useMemo(() => items.filter((item) => item.status === 'error'), [items]);
    const processedPercentage = totalItems > 0 ? Math.round((readyItems.length / totalItems) * 100) : 0;

    const cleanPreviewUrls = useCallback((targetItems) => {
        targetItems.forEach((item) => {
            if (item.originalPreviewUrl) {
                URL.revokeObjectURL(item.originalPreviewUrl);
            }
            if (item.convertedPreviewUrl) {
                URL.revokeObjectURL(item.convertedPreviewUrl);
            }
        });
    }, []);

    useEffect(() => {
        const previousItems = previousItemsRef.current;
        const removed = previousItems.filter((previous) => !items.some((item) => item.id === previous.id));
        if (removed.length > 0) {
            cleanPreviewUrls(removed);
        }
        previousItemsRef.current = items;
    }, [items, cleanPreviewUrls]);

    useEffect(() => {
        return () => {
            cleanPreviewUrls(previousItemsRef.current);
        };
    }, [cleanPreviewUrls]);

    const updateItem = useCallback((id, updater) => {
        setItems((current) =>
            current.map((item) => {
                if (item.id !== id) {
                    return item;
                }
                return typeof updater === 'function' ? {...item, ...updater(item)} : {...item, ...updater};
            })
        );
    }, []);

    const processFile = useCallback(async (id, file) => {
        updateItem(id, () => ({status: 'processing', errorMessage: ''}));
        try {
            const result = await convertImageFile(file);
            updateItem(id, () => ({
                status: 'ready',
                convertedFile: result.convertedFile,
                convertedPreviewUrl: result.convertedPreviewUrl,
                convertedSize: result.convertedFile.size,
                dimensions: {width: result.width, height: result.height},
            }));
        } catch (error) {
            console.error('Conversion failed', error);
            updateItem(id, () => ({
                status: 'error',
                errorMessage: error?.message || 'Conversion failed.',
            }));
        }
    }, [updateItem]);

    const addFiles = useCallback(
        (fileList) => {
            if (!fileList || fileList.length === 0) {
                return;
            }
            const accepted = [];
            const rejected = [];
            Array.from(fileList).forEach((file) => {
                const isSupported =
                    SUPPORTED_MIME_TYPES.includes(file.type) || /\.(png|jpg|jpeg)$/i.test(file.name || '');
                if (isSupported) {
                    accepted.push(file);
                } else {
                    rejected.push(file);
                }
            });
            if (rejected.length > 0) {
                setUploadMessage(`Skipped ${rejected.length} unsupported file${rejected.length > 1 ? 's' : ''}.`);
            } else {
                setUploadMessage('');
            }
            if (accepted.length === 0) {
                return;
            }
            const newItems = accepted.map((file) => {
                const id = createId();
                return {
                    id,
                    originalFile: file,
                    originalName: file.name || 'image',
                    originalSize: file.size,
                    originalPreviewUrl: URL.createObjectURL(file),
                    status: 'queued',
                    errorMessage: '',
                };
            });
            setItems((current) => [...newItems, ...current]);
            newItems.forEach((item) => {
                processFile(item.id, item.originalFile);
            });
        },
        [processFile]
    );

    const handleFileInputChange = useCallback(
        (event) => {
            addFiles(event.target.files);
            event.target.value = '';
        },
        [addFiles]
    );

    const handleDrop = useCallback(
        (event) => {
            event.preventDefault();
            setIsDragging(false);
            if (event.dataTransfer?.files) {
                addFiles(event.dataTransfer.files);
            }
        },
        [addFiles]
    );

    const handleDragOver = useCallback((event) => {
        event.preventDefault();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((event) => {
        event.preventDefault();
        setIsDragging(false);
    }, []);

    const removeItem = useCallback((id) => {
        setItems((current) => current.filter((item) => item.id !== id));
    }, []);

    const handleDownloadSingle = useCallback((item) => {
        if (!item?.convertedFile || !item?.convertedPreviewUrl) {
            return;
        }
        const link = document.createElement('a');
        link.href = item.convertedPreviewUrl;
        link.download = item.convertedFile.name;
        link.click();
    }, []);

    const handleBatchDownload = useCallback(async () => {
        const files = readyItems.map((item) => item.convertedFile).filter(Boolean);
        if (files.length === 0) {
            return;
        }
        try {
            setIsBatchDownloading(true);
            const zipBlob = await createZipFromFiles(files);
            const downloadUrl = URL.createObjectURL(zipBlob);
            const link = document.createElement('a');
            link.href = downloadUrl;
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            link.download = `yellowpages-greyscale-${timestamp}.zip`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(downloadUrl), 2000);
        } catch (error) {
            console.error('Batch download failed', error);
            setUploadMessage(error?.message || 'Unable to build download.');
        } finally {
            setIsBatchDownloading(false);
        }
    }, [readyItems]);

    const clearAll = useCallback(() => {
        setItems([]);
        setUploadMessage('');
    }, []);

    const retryItem = useCallback(
        (item) => {
            if (!item?.originalFile) {
                return;
            }
            processFile(item.id, item.originalFile);
        },
        [processFile]
    );

    const statusLabel = (status) => {
        switch (status) {
            case 'processing':
                return 'Processing…';
            case 'ready':
                return 'Ready';
            case 'error':
                return 'Needs attention';
            default:
                return 'Queued';
        }
    };

    return (
        <div className="min-h-screen bg-slate-50">
            <Head>
                <title>Greyscale Image Converter | The Yellow Pages</title>
            </Head>
            <Navbar />
            <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8 lg:py-16">
                <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg sm:p-8">
                    <div className="grid gap-8 lg:grid-cols-2">
                        <div className="space-y-6">
                            <div>
                                <p className="text-sm font-semibold uppercase tracking-widest text-yellow-600">
                                    Tools
                                </p>
                                <h1 className="mt-2 text-3xl font-extrabold text-slate-900 sm:text-4xl">
                                    Greyscale image converter
                                </h1>
                                <p className="mt-3 text-base text-slate-600">
                                    Upload JPGs or PNGs and get true luminance greyscale JPGs—done entirely in your browser.
                                </p>
                            </div>
                            <div
                                onDrop={handleDrop}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                className={`flex flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-10 text-center transition ${
                                    isDragging
                                        ? 'border-slate-900 bg-white'
                                        : 'border-slate-300 bg-white hover:border-slate-900'
                                }`}
                            >
                                <p className="text-lg font-semibold text-slate-900">
                                    Drag &amp; drop images here
                                </p>
                                <p className="mt-1 text-sm text-slate-500">
                                    Accepts JPG or PNG · converts everything to JPG
                                </p>
                                <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        className="rounded-xl border border-slate-900 px-5 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-900 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
                                    >
                                        Browse files
                                    </button>
                                    <button
                                        type="button"
                                        onClick={clearAll}
                                        className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900"
                                    >
                                        Clear queue
                                    </button>
                                </div>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    multiple
                                    accept="image/png,image/jpeg"
                                    onChange={handleFileInputChange}
                                    className="hidden"
                                />
                            </div>
                            {uploadMessage && (
                                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                                    {uploadMessage}
                                </div>
                            )}
                        </div>
                        <div className="space-y-6">
                            <div className="rounded-2xl border border-slate-200 bg-white p-5">
                                <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-slate-500">
                                    <span>Batch status</span>
                                    <span className="font-semibold text-slate-900">{processedPercentage}%</span>
                                </div>
                                <div className="mt-3 h-1.5 rounded-full bg-slate-100">
                                    <div
                                        className="h-1.5 rounded-full bg-slate-900 transition-all duration-300"
                                        style={{width: `${processedPercentage}%`}}
                                    />
                                </div>
                                <p className="mt-3 text-sm text-slate-600">
                                    {readyItems.length} of {totalItems || 0} image
                                    {totalItems === 1 ? '' : 's'} ready
                                </p>
                                {errorItems.length > 0 && (
                                    <p className="mt-1 text-sm text-rose-500">
                                        {errorItems.length} item{errorItems.length > 1 ? 's' : ''} need attention
                                    </p>
                                )}
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-white p-5">
                                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
                                    Batch download
                                </p>
                                <p className="mt-2 text-sm text-slate-600">
                                    Download every converted JPG at once. We package everything locally into a zip so
                                    nothing leaves your browser.
                                </p>
                                <button
                                    type="button"
                                    onClick={handleBatchDownload}
                                    disabled={readyItems.length === 0 || isBatchDownloading}
                                    className="mt-4 w-full rounded-xl border border-slate-900 px-4 py-2 text-center text-sm font-semibold text-slate-900 transition hover:bg-slate-900 hover:text-white disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                                >
                                    {isBatchDownloading ? 'Preparing zip…' : 'Download all as zip'}
                                </button>
                                <p className="mt-2 text-xs text-slate-500">
                                    Individual downloads stay available in each card below if you prefer to pick and
                                    choose.
                                </p>
                            </div>
                        </div>
                    </div>
                </section>

                <section>
                    <div className="mb-4 flex items-center justify-between">
                        <div>
                            <h2 className="text-2xl font-bold text-slate-900">Conversion queue</h2>
                            <p className="text-sm text-slate-500">
                                Preview the original next to the greyscale export, then download or remove files one by
                                one.
                            </p>
                        </div>
                        {totalItems > 0 && (
                            <span className="rounded-full border border-slate-200 bg-white px-4 py-1 text-sm font-semibold text-slate-600">
                                {totalItems} item{totalItems > 1 ? 's' : ''} queued
                            </span>
                        )}
                    </div>
                    {items.length === 0 ? (
                        <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white px-8 py-16 text-center text-slate-500">
                            <p className="text-lg font-semibold text-slate-700">No images yet</p>
                            <p className="mt-2 text-sm">
                                Use the panel above to upload JPGs or PNGs and we will list them here with live previews.
                            </p>
                        </div>
                    ) : (
                        <div className="grid gap-6 lg:grid-cols-2">
                            {items.map((item) => (
                                <article
                                    key={item.id}
                                    className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white"
                                >
                                    <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
                                        <div>
                                            <p className="text-base font-semibold text-slate-900">{item.originalName}</p>
                                            <p className="text-xs uppercase tracking-widest text-slate-500">
                                                {statusLabel(item.status)} · {formatBytes(item.originalSize)}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => removeItem(item.id)}
                                                className="text-xs font-semibold uppercase tracking-widest text-slate-400 hover:text-slate-900"
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    </div>
                                    <div className="grid flex-1 gap-4 p-5 sm:grid-cols-2">
                                        <div className="space-y-2 rounded-2xl border border-slate-100 p-4">
                                            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                                                Original
                                            </p>
                                            <div className="relative overflow-hidden rounded-xl bg-slate-100">
                                                {item.originalPreviewUrl ? (
                                                    <img
                                                        src={item.originalPreviewUrl}
                                                        alt={`${item.originalName} original preview`}
                                                        className="h-48 w-full object-contain bg-white"
                                                        loading="lazy"
                                                    />
                                                ) : (
                                                    <div className="flex h-48 items-center justify-center text-sm text-slate-400">
                                                        Preview unavailable
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="space-y-2 rounded-2xl border border-slate-100 p-4">
                                            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                                                Greyscale JPG
                                            </p>
                                            <div className="relative overflow-hidden rounded-xl bg-slate-100">
                                                {item.status === 'ready' && item.convertedPreviewUrl ? (
                                                    <img
                                                        src={item.convertedPreviewUrl}
                                                        alt={`${item.originalName} greyscale preview`}
                                                        className="h-48 w-full object-contain bg-white"
                                                        loading="lazy"
                                                    />
                                                ) : item.status === 'error' ? (
                                                    <div className="flex h-48 items-center justify-center text-center text-sm text-rose-500">
                                                        {item.errorMessage || 'Conversion failed.'}
                                                    </div>
                                                ) : (
                                                    <div className="flex h-48 flex-col items-center justify-center gap-3 text-sm text-slate-500">
                                                        <span className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-transparent" />
                                                        Converting…
                                                    </div>
                                                )}
                                            </div>
                                            {item.status === 'ready' && item.dimensions && (
                                                <p className="text-xs text-slate-500">
                                                    {item.dimensions.width} × {item.dimensions.height}px · {formatBytes(item.convertedSize)}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="border-t border-slate-100 px-5 py-4">
                                        {item.status === 'error' ? (
                                            <div className="flex flex-wrap items-center gap-3">
                                                <p className="text-sm font-medium text-rose-600">
                                                    {item.errorMessage || 'Something went wrong.'}
                                                </p>
                                                <button
                                                    type="button"
                                                    onClick={() => retryItem(item)}
                                                    className="rounded-full bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500"
                                                >
                                                    Retry conversion
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex flex-wrap items-center gap-3">
                                                <button
                                                    type="button"
                                                    onClick={() => handleDownloadSingle(item)}
                                                    disabled={item.status !== 'ready'}
                                                    className="rounded-xl border border-slate-900 px-5 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-900 hover:text-white disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                                                >
                                                    Download JPG
                                                </button>
                                                {item.convertedFile && (
                                                    <p className="text-xs text-slate-500">
                                                        Saved as {item.convertedFile.name}
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </article>
                            ))}
                        </div>
                    )}
                </section>
            </main>
        </div>
    );
}
