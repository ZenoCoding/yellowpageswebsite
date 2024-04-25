import Date from "./date";

export default function ArticlePreview(props) {
    return <div>
        <h2 className="text-2xl font-bold mt-10">Preview</h2>
        <div>
            <hr className="my-5 bg-gray-900 dark:bg-gray-200"/>
        </div>
        <article>
            <h1 className="text-4xl mb-1">{props.formData.title === "" ? "Placeholder Title" : props.formData.title}</h1>
            <div className="text-gray-500">
                <Date dateString={props.formData.date}/>
            </div>
            <div className="text-gray-500 mb-4">
                By {props.formData.author}
            </div>

            <div dangerouslySetInnerHTML={{__html: props.html}}/>
        </article>
    </div>;
}