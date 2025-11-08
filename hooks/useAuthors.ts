import {useEffect, useMemo, useState} from 'react';
import {authorsQuery, AuthorRecord} from '../lib/authors';
import {onSnapshot, QueryDocumentSnapshot, Timestamp} from 'firebase/firestore';

export interface UseAuthorsResult {
    authors: AuthorRecord[];
    loading: boolean;
    error: Error | null;
}

interface UseAuthorsOptions {
    enabled?: boolean;
}

const convertTimestamp = (value: unknown) => {
    if (!value) {
        return undefined;
    }
    if (value instanceof Date) {
        return value;
    }
    if (value instanceof Timestamp) {
        return value.toDate();
    }
    return undefined;
};

const mapDocToAuthor = (snapshot: QueryDocumentSnapshot): AuthorRecord => {
    const data = snapshot.data() as Record<string, unknown>;
    const author: AuthorRecord = {
        id: snapshot.id,
        fullName: typeof data.fullName === 'string' ? data.fullName : '',
        photoUrl: typeof data.photoUrl === 'string' ? data.photoUrl : undefined,
        graduationYear: typeof data.graduationYear === 'number' ? data.graduationYear : undefined,
        position: typeof data.position === 'string' ? data.position : undefined,
        bio: typeof data.bio === 'string' ? data.bio : undefined,
        authorSlug: typeof data.authorSlug === 'string' ? data.authorSlug : undefined,
        isHidden: typeof data.isHidden === 'boolean' ? data.isHidden : undefined,
        hasDeparted: typeof data.hasDeparted === 'boolean' ? data.hasDeparted : undefined,
        linkedArticleIds: Array.isArray(data.linkedArticleIds)
            ? (data.linkedArticleIds as unknown[]).filter((value): value is string => typeof value === 'string')
            : undefined,
        lastUsedAt: convertTimestamp(data.lastUsedAt),
        createdAt: convertTimestamp(data.createdAt),
        updatedAt: convertTimestamp(data.updatedAt),
    };
    return author;
};

export const useAuthors = ({enabled = true}: UseAuthorsOptions = {}): UseAuthorsResult => {
    const [authors, setAuthors] = useState<AuthorRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        if (!enabled) {
            setAuthors([]);
            setLoading(false);
            setError(null);
            return;
        }

        let isMounted = true;
        setLoading(true);
        const unsubscribe = onSnapshot(
            authorsQuery(),
            (snapshot) => {
                if (!isMounted) return;
                const nextAuthors = snapshot.docs.map(mapDocToAuthor);
                setAuthors(nextAuthors);
                setLoading(false);
                setError(null);
            },
            (snapshotError) => {
                if (!isMounted) return;
                setError(snapshotError instanceof Error ? snapshotError : new Error('Unable to load authors'));
                setLoading(false);
            }
        );

        return () => {
            isMounted = false;
            unsubscribe();
        };
    }, [enabled]);

    return useMemo(
        () => ({
            authors,
            loading,
            error,
        }),
        [authors, loading, error]
    );
};
