import {getApp} from 'firebase/app';
import {
    addDoc,
    arrayRemove,
    arrayUnion,
    collection,
    deleteDoc,
    doc,
    FieldValue,
    getFirestore,
    orderBy,
    query,
    serverTimestamp,
    updateDoc,
} from 'firebase/firestore';

export interface AuthorRecord {
    id: string;
    fullName: string;
    photoUrl?: string;
    graduationYear?: number;
    position?: string;
    bio?: string;
    linkedArticleIds?: string[];
    lastUsedAt?: Date;
    createdAt?: Date;
    updatedAt?: Date;
    authorSlug?: string;
    isHidden?: boolean;
    hasDeparted?: boolean;
}

export type AuthorInput = Omit<AuthorRecord, 'id' | 'createdAt' | 'updatedAt' | 'lastUsedAt'> & {
    lastUsedAt?: Date | FieldValue;
};

const getDb = () => {
    return getFirestore(getApp());
};

export const authorsCollection = () => collection(getDb(), 'authors');

export const authorsQuery = () => query(authorsCollection(), orderBy('fullName'));

const removeUndefinedFields = <T extends Record<string, unknown>>(data: T) => {
    return Object.fromEntries(
        Object.entries(data).filter(([, value]) => value !== undefined)
    ) as T;
};

export const createAuthor = async (payload: AuthorInput) => {
    const docRef = await addDoc(authorsCollection(), {
        ...removeUndefinedFields(payload),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });
    return docRef;
};

export const updateAuthor = async (authorId: string, payload: Partial<AuthorInput>) => {
    await updateDoc(doc(getDb(), 'authors', authorId), {
        ...removeUndefinedFields(payload),
        updatedAt: serverTimestamp(),
    });
};

export const deleteAuthor = async (authorId: string) => {
    await deleteDoc(doc(getDb(), 'authors', authorId));
};

const normalizeIdList = (input: string[] | undefined | null) => {
    if (!Array.isArray(input)) {
        return [];
    }
    return input
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value) => value.length > 0);
};

interface SyncAuthorArticleLinksOptions {
    articleId: string;
    nextAuthorIds: string[];
    previousAuthorIds?: string[];
}

export const syncAuthorArticleLinks = async ({
    articleId,
    nextAuthorIds,
    previousAuthorIds = [],
}: SyncAuthorArticleLinksOptions) => {
    const db = getDb();
    const cleanedNext = new Set(normalizeIdList(nextAuthorIds));
    const cleanedPrevious = new Set(normalizeIdList(previousAuthorIds));

    const toAdd = Array.from(cleanedNext).filter((id) => !cleanedPrevious.has(id));
    const toRemove = Array.from(cleanedPrevious).filter((id) => !cleanedNext.has(id));

    const operations: Promise<unknown>[] = [];

    toAdd.forEach((authorId) => {
        operations.push(
            updateDoc(doc(db, 'authors', authorId), {
                linkedArticleIds: arrayUnion(articleId),
                lastUsedAt: serverTimestamp(),
            })
        );
    });

    toRemove.forEach((authorId) => {
        operations.push(
            updateDoc(doc(db, 'authors', authorId), {
                linkedArticleIds: arrayRemove(articleId),
            })
        );
    });

    if (operations.length === 0) {
        return;
    }

    await Promise.allSettled(operations);
};
