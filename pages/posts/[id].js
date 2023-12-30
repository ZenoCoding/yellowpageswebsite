import {getArticleContent} from '../../lib/firebase'
import Date from '../../components/date'
import {makeCommaSeparatedString} from '../../lib/makeCommaSeparatedString'
import {useRouter} from 'next/router';
import ContentNavbar from "../../components/ContentNavbar";
import {doc, getDoc, getFirestore} from "firebase/firestore";
import {getApp} from "firebase/app";
import {getStorage} from "firebase/storage";

const app = getApp()
const db = getFirestore(app)
const storage = getStorage(app)

export default function Post({articleData, content}) {
    const authorData = makeCommaSeparatedString(articleData.author, true);
    const router = useRouter();
    return (
        <div className="m-auto px-5 max-w-2xl my-10">
            <ContentNavbar/>
            <style jsx global>{`
                a {
                    color: rgb(59 130 246);
                }

                a:hover {
                    text-decoration: underline;
                }
            `}</style>
            <h1 className="text-4xl mb-1">{articleData.title}</h1>
            <div className="text-gray-500">
                <Date dateString={articleData.date}/>
            </div>
            <div className="text-gray-500 mb-4">
                By {authorData}
            </div>

            <div dangerouslySetInnerHTML={{__html: content.contentHtml}}/>
            <div className="hover:underline text-blue-500 mb-5 cursor-pointer ">
                <a onClick={() => router.back()}>← Back</a>
            </div>
        </div>
    )
}

export async function getServerSideProps({params}) {
    const articleData = await getDoc(doc(db, "articles", params.id))
    const content = await getArticleContent(params.id)
    return {
        props: {
            articleData: articleData.data(),
            content
        }
    }
}
