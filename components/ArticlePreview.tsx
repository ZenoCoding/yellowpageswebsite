import Date from "./date";

export default function ArticlePreview(props) {
    const formData = props.formData || {};
    const authorTokens = Array.isArray(formData.authors)
        ? formData.authors
        : typeof formData.author === 'string'
            ? formData.author
                .split(',')
                .map((author) => author.trim())
                .filter((author) => author.length > 0)
            : [];
    const authorText = authorTokens.length > 0 ? authorTokens.join(', ') : 'Staff Name';
    const title =
        typeof formData.title === 'string' && formData.title.trim().length > 0
            ? formData.title.trim()
            : 'Placeholder Title';
    const dateString = typeof formData.date === 'string' ? formData.date : '';
    const hasDate = dateString.trim().length > 0;

    return <div>
        <h2 className="text-2xl font-bold mt-10">Preview</h2>
        <div>
            <hr className="my-5 bg-gray-900 dark:bg-gray-200"/>
        </div>
        <article>
            <h1 className="text-4xl mb-1">{title}</h1>
            <div className="text-gray-500">
                {hasDate ? <Date dateString={dateString}/> : <span>Select a date</span>}
            </div>
            <div className="text-gray-500 mb-4">
                By {authorText}
            </div>

            <div dangerouslySetInnerHTML={{__html: props.html}}/>
        </article>
    </div>;
}
