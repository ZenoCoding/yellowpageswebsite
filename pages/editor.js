import Link from 'next/link';
import ContentNavbar from "../components/ContentNavbar";
import Logo, { LogoIcon } from "../components/Logo";
import {doc, getDoc} from "firebase/firestore";
import {getAdmins, getArticleContent} from "../lib/firebase";
import {useUser} from "../firebase/useUser";
import NoAuth from "../components/auth/NoAuth";

export default function Editor({ admins }) {
    const {user} = useUser();
    if (user == null) {
        return <NoAuth/>
    } else if (!Array.from(admins).includes(user.id)) {
        return <NoAuth permission={true}/>
    }

    return (
        <div className="min-h-screen bg-gray-100">
            <ContentNavbar />
            <div className="container mx-auto py-8 px-4">
                <div className="flex mb-8">
                    <h1 className="text-3xl font-bold">Editor Dashboard</h1>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <div className="bg-white shadow rounded-lg p-6">
                        <h2 className="text-xl font-semibold mb-4">Recent Articles</h2>
                        <ul>
                            <li className="mb-2">Article 1</li>
                            <li className="mb-2">Article 2</li>
                            <li className="mb-2">Article 3</li>
                        </ul>
                        <Link
                            href="/upload"
                            className="inline-flex items-center rounded bg-blue-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
                        >
                            Create New Article
                        </Link>
                    </div>
                    <div className="bg-white shadow rounded-lg p-6">
                        <h2 className="text-xl font-semibold mb-4">Drafts</h2>
                        <ul>
                            <li className="mb-2">Draft 1</li>
                            <li className="mb-2">Draft 2</li>
                            <li className="mb-2">Draft 3</li>
                        </ul>
                    </div>
                    <div className="bg-white shadow rounded-lg p-6">
                        <h2 className="text-xl font-semibold mb-4">Staff Directory</h2>
                        <p className="text-sm text-gray-600 mb-4">
                            Keep the staff list up to date so the upload form stays accurate and minimal.
                        </p>
                        <Link
                            href="/admin/authors"
                            className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                        >
                            Manage Staff
                        </Link>
                    </div>
                    <div className="bg-white shadow rounded-lg p-6">
                        <h2 className="text-xl font-semibold mb-4">Statistics</h2>
                        <p>Total Views: 1234</p>
                        <p>Total Likes: 567</p>
                    </div>
                </div>
            </div>
        </div>
    );
}

export async function getServerSideProps() {
    const admins = await getAdmins();
    return {
        props: {
            admins: admins.admins
        }
    }
}
