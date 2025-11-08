import { format, isValid, parseISO } from 'date-fns';

interface ArticleCardPreviewProps {
    formData: {
        title?: string;
        author?: string;
        authors?: string[];
        date?: string;
        imageUrl?: string;
    };
}

const formatPreviewDate = (value?: string) => {
    if (!value || typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return null;
    }

    const parsedIso = parseISO(trimmed);
    const parsedDate = isValid(parsedIso) ? parsedIso : new Date(trimmed);
    if (!isValid(parsedDate)) {
        return null;
    }

    return format(parsedDate, 'MMMM d, yyyy');
};

const buildByline = (authorTokens: string[], publishedOn: string | null) => {
    const names = authorTokens.length > 0 ? authorTokens.join(', ') : 'Staff Name';
    if (publishedOn) {
        return `By ${names} • ${publishedOn}`;
    }
    return `By ${names}`;
};

export default function ArticleCardPreview({formData}: ArticleCardPreviewProps) {
    const title =
        typeof formData.title === 'string' && formData.title.trim().length > 0
            ? formData.title.trim()
            : 'Placeholder Title';
    const authorTokens = Array.isArray(formData.authors)
        ? formData.authors
        : typeof formData.author === 'string'
            ? formData.author
                  .split(',')
                  .map((token) => token.trim())
                  .filter((token) => token.length > 0)
            : [];
    const publishedOn = formatPreviewDate(formData.date);
    const bylineText = buildByline(authorTokens, publishedOn);
    const hasImage = typeof formData.imageUrl === 'string' && formData.imageUrl.trim().length > 0;

    return (
        <section className="mt-12">
            <h2 className="text-2xl font-bold">Inline Homepage Preview</h2>
            <div className="mt-5 border-t border-b border-slate-200 py-6">
                <article className={`group ${hasImage ? 'grid grid-cols-[120px_minmax(0,1fr)] items-start gap-4' : ''}`}>
                    {hasImage && (
                        <div className="overflow-hidden rounded-sm bg-slate-100">
                            <img
                                src={formData.imageUrl}
                                alt="Inline article preview"
                                className="h-24 w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                            />
                        </div>
                    )}
                    <div>
                        <h3 className="text-lg font-semibold leading-snug text-slate-900 transition-colors duration-200 group-hover:text-yellow-700">
                            {title}
                        </h3>
                        <p className="mt-2 text-sm font-medium text-slate-600">{bylineText}</p>
                    </div>
                </article>
                {!hasImage && (
                    <p className="mt-4 text-xs uppercase tracking-[0.3em] text-slate-400">No image attached</p>
                )}
                {!publishedOn && (
                    <p className="mt-4 text-xs text-amber-600">
                        Add a publish date to show how the timestamp will appear on the homepage.
                    </p>
                )}
            </div>
        </section>
    );
}
