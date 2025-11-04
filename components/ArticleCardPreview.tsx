interface ArticleCardPreviewProps {
    formData: {
        title?: string;
        author?: string;
        authors?: string[];
        blurb?: string;
        imageUrl?: string;
        tags?: string[];
    };
}

export default function ArticleCardPreview({formData}: ArticleCardPreviewProps) {
    const title = formData.title?.trim() || 'Placeholder Title';
    const authorTokens = Array.isArray(formData.authors)
        ? formData.authors
        : typeof formData.author === 'string'
            ? formData.author
                .split(',')
                .map((author) => author.trim())
                .filter((author) => author.length > 0)
            : [];
    const author = authorTokens.length > 0 ? authorTokens.join(', ') : 'Staff Name';
    const blurb = formData.blurb?.trim() || 'This is where your blurb will appear.';
    const imageUrl = formData.imageUrl?.trim();
    const tags = Array.isArray(formData.tags) ? formData.tags : [];

    return (
        <div className="mt-12">
            <h2 className="text-2xl font-bold">Homepage Card Preview</h2>
            <div className="mt-5">
                <div className="group flex rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:border-yellow-300 hover:shadow-lg">
                    {imageUrl ? (
                        <div className="relative w-40 flex-shrink-0 overflow-hidden rounded-l-2xl bg-yellow-100 sm:w-44 md:w-48">
                            <img
                                src={imageUrl}
                                alt={`Cover image preview for ${title}`}
                                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                            />
                        </div>
                    ) : (
                        <div className="hidden h-full w-40 flex-shrink-0 items-center justify-center rounded-l-2xl bg-yellow-100 text-xs font-medium uppercase tracking-[0.2em] text-yellow-700 sm:flex">
                            Add Image
                        </div>
                    )}
                    <div className={`flex flex-1 flex-col gap-3 p-4 sm:p-5 ${imageUrl ? '' : 'rounded-2xl border border-dashed border-yellow-200 bg-yellow-50/60'}`}>
                        <h3 className="text-base font-semibold text-slate-900 transition-colors duration-300 group-hover:text-yellow-700">
                            {title}
                        </h3>
                        <p className="text-sm leading-relaxed text-slate-700">{blurb}</p>
                        {tags.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {tags.map((tag) => (
                                    <span
                                        key={tag.toLowerCase()}
                                        className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[0.7rem] font-medium uppercase tracking-wide text-slate-500"
                                    >
                                        {tag}
                                    </span>
                                ))}
                            </div>
                        )}
                        <p className="text-[0.75rem] font-medium text-slate-600">
                            By {author}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
