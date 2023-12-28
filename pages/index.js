import {getAllArticleData} from '../lib/firebase'
import Link from 'next/link'
import Navbar from "../components/Navbar.js"
import {format, parseISO} from 'date-fns'
import {makeCommaSeparatedString} from '../lib/makeCommaSeparatedString'
import { useState } from 'react';
import {CiSearch} from "react-icons/ci";

export default function Home({ allArticleData }) {
    const [searchTerm, setSearchTerm] = useState('');

    const handleSearchChange = (event) => {
        setSearchTerm(event.target.value);
    };

    const filteredArticles = allArticleData.filter((article) =>
        article.title.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="bg-white">
            <Navbar/>
            <div className="mx-auto justify-center max-w-2xl px-4 sm:px-6 lg:max-w-7xl lg:px-8">
                <div className="columns-1 md:columns-2 lg:columns-3 gap-4 p-8">
                    {filteredArticles.map(({id, date, author, title, tags, blurb}) => (
                        <div className="break-inside h-min w-full max-w-sm overflow-visible rounded-lg mx-auto">
                            <Link href={`/posts/${id}`} legacyBehavior>
                                <div className="block max-w-sm p-3 bg-white border border-slate-700 rounded-lg shadow-md hover:shadow-none hover:bg-gray-100 hover:no-underline dark:bg-gray-800 dark:border-gray-700 dark:hover:bg-gray-700">
                                    <h5 className="leading-snug text-lg font-semibold tracking-tight text-gray-900 dark:text-white">{title}</h5>
                                    <h5 className="mb-0.5 text-sm tracking-tight text-gray-500 dark:text-white">By {makeCommaSeparatedString(author)} | {format(parseISO(date), 'LLLL d, yyyy')}</h5>
                                    <p className="mb-0.5 text-sm text-gray-700 dark:text-gray-400">{blurb}</p>
                                </div>
                            </Link>
                            <div className="mb-4"></div>
                        </div>
                    ))}

                </div>
            </div>
        </div>
    );
}

export async function getServerSideProps() {
    const allArticleData = await getAllArticleData()
    return {
        props: {
            allArticleData
        }
    }
}
