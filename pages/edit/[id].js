import {getAdmins, getArticleContent} from '../../lib/firebase'
import {getApp} from "firebase/app"
import {doc, getDoc, getFirestore, updateDoc} from "firebase/firestore"
import {getDownloadURL, getStorage, ref, uploadBytesResumable} from "firebase/storage";
import matter from 'gray-matter';
import {remark} from 'remark';
import {useRouter} from 'next/router';
import {getAuth, signOut} from "firebase/auth";
import {useUser} from "../../firebase/useUser";
import {useState} from 'react'
import html from 'remark-html';
import Link from 'next/link'
import {format, parseISO} from 'date-fns'
import {makeCommaSeparatedString} from '../../lib/makeCommaSeparatedString'
import ContentNavbar from "../../components/ContentNavbar";

//reinstating, not in lib/firebase cause fs being stinky
const app = getApp()
const db = getFirestore(app)
const storage = getStorage(app)


export default function Post({articleData, content, admins}) {
    //then get the text field changes from here
    const auth = getAuth();
    const {user} = useUser();
    const router = useRouter();
    const articleId = router.query.id

    // Define states for form fields
    const [formData, setFormData] = useState({
        title: articleData.title,
        author: makeCommaSeparatedString(articleData.author),
        date: articleData.date,
        blurb: articleData.blurb,
        tags: makeCommaSeparatedString(articleData.tags),
        imageUrl: articleData.imageUrl || '',
        size: articleData.size || 'normal',
        markdown: content.markdown,
    });

    const [uploadData, setUploadData] = useState("");
    const [errorData, setErrorData] = useState("");
    const [isUploading, setIsUploading] = useState(false);

    // Form input change handlers
    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData((prevFormData) => ({
            ...prevFormData,
            [name]: value,
        }));
    };

    if (user == null) {
        return (<div>You're not logged in my man</div>)
    }
    // console.log(admins);
    const inc = Array.from(admins).includes(user.id);
    const handleClick = (e) => {
        signOut(auth).then(() => {
            // Sign-out successful.
        }).catch((error) => {
            // An error happened.
        });
    };
    if (!inc) {
        return (
            <div>Sorry, you're not authorized.
                <Link href="/" onClick={(e) => handleClick(e)}>
                    Sign out
                </Link>
            </div>
        )
    }

    // Markdown to HTML conversion
    const convertMarkdownToHtml = async (markdown) => {
        try {
            const processedContent = await remark().use(html).process(markdown);
            return processedContent.toString();
        } catch (error) {
            throw new Error('Markdown to HTML conversion failed: ' + error.message);
        }
    };

    // Form submission handler
    // Form submission handler
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
                // ...
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
                    const dateObject = parseISO(formData.date)

                    // Update Firestore document with the new metadata and content references
                    await updateDoc(doc(db, "articles", articleId), {
                        title: formData.title,
                        author: formData.author.split(',').map((a) => a.trim()),
                        date: formData.date,
                        blurb: formData.blurb,
                        tags: formData.tags.split(',').map((tag) => tag.trim()),
                        imageUrl: formData.imageUrl,
                        size: formData.size,
                        path: `articles/${articleId}.md`,
                    });

                    setUploadData("Upload Successful! Redirecting to the article page...");
                    setTimeout(() => router.push(`/posts/${articleId}`), 5000);
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
            <ContentNavbar />
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
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm sm:text-sm"
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
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm sm:text-sm"
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
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm sm:text-sm"
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
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm sm:text-sm"
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
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm sm:text-sm"
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
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm sm:text-sm"
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
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm sm:text-sm"
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
                        onChange={handleChange}
                        rows={10}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm sm:text-sm"
                    />
                </div>

                <div className="flex items-center justify-between">
                    <button
                        type="submit"
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                        disabled={isUploading}
                    >
                        {isUploading ? 'Updating...' : 'Update Article'}
                    </button>
                    {errorData && <p className="text-red-500">{errorData}</p>}
                    {uploadData && <p className="text-green-500">{uploadData}</p>}
                </div>
            </form>
        </div>
    );
}

export async function getServerSideProps({params}) {
    const articleData = await getDoc(doc(db, "articles", params.id))
    const content = await getArticleContent(params.id)
    const admins = await getAdmins();
    const ret = admins.admins;
    return {
        props: {
            articleData: articleData.data(),
            content: content,
            admins: ret
        }
    }
}
