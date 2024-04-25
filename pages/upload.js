import Date from '../components/date'
import {getAdmins} from '../lib/firebase'
import {getApp} from "firebase/app"
import {doc, getFirestore, setDoc} from "firebase/firestore"
import {getDownloadURL, getStorage, ref, uploadBytesResumable} from "firebase/storage";
import {remark} from 'remark';
import {useRouter} from 'next/router';
import {getAuth} from "firebase/auth";
import {useUser} from "../firebase/useUser";
import {useState} from 'react'
import html from 'remark-html';
import {format, parseISO} from 'date-fns'
import NoAuth from "../components/auth/NoAuth";
import ContentNavbar from "../components/ContentNavbar";
import ArticlePreview from "../components/ArticlePreview";
import matter from "gray-matter";

// var user_id = null;

//reinstating, not in lib/firebase cause fs being stinky
const app = getApp()
const db = getFirestore(app)
const storage = getStorage(app)

export default function Upload({admins}) {
    const auth = getAuth();
    const {user} = useUser();
    const router = useRouter();

    if (user == null) {
        return <NoAuth/>
    } else if (!Array.from(admins).includes(user.id)){
        return <NoAuth permission={true}/>
    }

    const [formData, setFormData] = useState({
        title: "",
        author: "",
        date: "",
        blurb: "",
        tags: "",
        imageUrl: "",
        size: 'normal',
        markdown: "",
    });

    const [uploadData, setUploadData] = useState("");
    const [errorData, setErrorData] = useState("");
    const [isUploading, setIsUploading] = useState(false);

    const [htmlData, setHtmlData] = useState("");
    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData((prevFormData) => ({
            ...prevFormData,
            [name]: value,
        }));
    };

    const handleMarkdownChange = (e) => {
        setFormData((prevFormData) => ({
            ...prevFormData,
            markdown: e.target.value,
        }));
        // update the HTML preview
        convertMarkdownToHtml(e.target.value).then((html) => setHtmlData(html));
    }

    const convertMarkdownToHtml = async (markdown) => {
        try {
            const processedContent = await remark().use(html).process(matter(markdown).content);
            return processedContent.toString();
        } catch (error) {
            throw new Error('Markdown to HTML conversion failed: ' + error.message);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setErrorData('');
        setIsUploading(true);

        // Perform validation checks here
        if (!formData.title || !formData.author || !formData.date) {
            setErrorData('Please fill out all required fields.');
            setIsUploading(false);
            return;
        }

        // Convert markdown to HTML and validate
        let contentHtml;
        try {
            contentHtml = await convertMarkdownToHtml(formData.markdown);
        } catch (error) {
            setErrorData(error.message);
            setIsUploading(false);
            return;
        }
        const urlify = require('urlify').create({
            addEToUmlauts: true,
            szToSs: true,
            spaces: "_",
            nonPrintable: "_",
            trim: true
        });

        const dateObject = parseISO(formData.date)
        const articleId = format(dateObject, 'yyyy-MM-dd') + '_' + urlify(formData.title)

        // Create a Blob from the markdown content
        const file = new Blob([formData.markdown], {type: "text/plain"});
        const markdownRef = ref(storage, `articles/${articleId}.md`); // Adjust the path as needed

        // Upload the Blob to Firebase Storage
        const uploadTask = uploadBytesResumable(markdownRef, file);

        uploadTask.on('state_changed',
            (snapshot) => {
                // Handle state changes, such as progress, pause, and resume
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                setUploadData('Upload is ' + progress + '% done');
            },
            (error) => {
                // Handle unsuccessful uploads
                setErrorData(error.message);
                setIsUploading(false);
            },
            async () => {
                // Handle successful uploads on complete
                try {
                    // Get the download URL for the uploaded markdown content
                    const markdownDownloadURL = await getDownloadURL(uploadTask.snapshot.ref);

                    // Update Firestore document with the new metadata and content references
                    await setDoc(doc(db, "articles", articleId), {
                        title: formData.title,
                        author: formData.author.split(',').map((a) => a.trim()),
                        date: formData.date,
                        blurb: formData.blurb,
                        tags: formData.tags.split(',').map((tag) => tag.trim()),
                        imageUrl: formData.imageUrl,
                        size: formData.size,
                        path: `articles/${articleId}.md`,
                    });

                    setUploadData("Upload Successful!");
                    await router.push(`/posts/${articleId}`);
                } catch (error) {
                    setErrorData(error.message);
                    setIsUploading(false);
                }
            }
        );
    };

    // JSX for the form within the Post component
    return (
        <div className="m-auto max-w-2xl my-10 px-5">
            <ContentNavbar/>
            <h1 className="text-3xl font-bold mb-3">Upload Article</h1>
            <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                    <label htmlFor="title" className="block text-sm font-medium text-gray-700">
                        Title
                    </label>
                    <input
                        id="title"
                        name="title"
                        type="text"
                        required
                        value={formData.title}
                        onChange={handleChange}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm sm:text-sm p-2"
                    />
                </div>

                <div>
                    <label htmlFor="author" className="block text-sm font-medium text-gray-700">
                        Author(s)
                    </label>
                    <input
                        id="author"
                        name="author"
                        type="text"
                        required
                        value={formData.author}
                        onChange={handleChange}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm sm:text-sm p-2"
                    />
                </div>

                <div>
                    <label htmlFor="date" className="block text-sm font-medium text-gray-700">
                        Date
                    </label>
                    <input
                        id="date"
                        name="date"
                        type="date"
                        required
                        value={formData.date}
                        onChange={handleChange}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm sm:text-sm p-2"
                    />
                </div>

                <div>
                    <label htmlFor="blurb" className="block text-sm font-medium text-gray-700">
                        Blurb
                    </label>
                    <textarea
                        id="blurb"
                        name="blurb"
                        required
                        value={formData.blurb}
                        onChange={handleChange}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm sm:text-sm p-2"
                    />
                </div>

                <div>
                    <label htmlFor="tags" className="block text-sm font-medium text-gray-700">
                        Tags
                    </label>
                    <input
                        id="tags"
                        name="tags"
                        type="text"
                        required
                        value={formData.tags}
                        onChange={handleChange}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm sm:text-sm p-2"
                    />
                </div>

                <div>
                    <label htmlFor="imageUrl" className="block text-sm font-medium text-gray-700">
                        Image URL
                    </label>
                    <input
                        id="imageUrl"
                        name="imageUrl"
                        type="text"
                        value={formData.imageUrl}
                        onChange={handleChange}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm sm:text-sm p-2"
                    />
                </div>

                <div>
                    <label htmlFor="size" className="block text-sm font-medium text-gray-700">
                        Article Size
                    </label>
                    <select
                        id="size"
                        name="size"
                        value={formData.size}
                        onChange={handleChange}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm sm:text-sm p-2"
                    >
                        <option value="normal">Normal</option>
                        <option value="medium">Medium</option>
                        <option value="large">Large</option>
                        <option value="small">Small</option>
                    </select>
                </div>

                <div>
                    <label htmlFor="markdown" className="block text-sm font-medium text-gray-700">
                        Markdown
                    </label>
                    <textarea
                        id="markdown"
                        name="markdown"
                        required
                        value={formData.markdown}
                        onChange={handleMarkdownChange}
                        rows={10}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm sm:text-sm p-2"
                    />
                </div>

                <a href={"https://docs.google.com/document/d/1_lNHBxtpaBa1JRqrbapmCj_L_k-yfSsTSkgGp_1pnL0/edit"}
                   className="underline italic text-gray-500">Confused?</a>

                <div className="flex items-center justify-between">
                    <button
                        type="submit"
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                        disabled={isUploading}
                    >
                        {isUploading ? 'Uploading...' : 'Upload Article'}
                    </button>
                    {errorData && <p className="text-red-500">{errorData}</p>}
                    {uploadData && <p className="text-green-500">{uploadData}</p>}
                </div>
            </form>
            <ArticlePreview formData={formData} html={htmlData}/>
        </div>
    );
};

export async function getServerSideProps({params}) {
    const admins = await getAdmins();
    const ret = admins.admins;
    return {
        props: {
            admins: ret
        }
    }
}