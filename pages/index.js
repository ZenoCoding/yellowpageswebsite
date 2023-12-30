import { getAllArticleData } from '../lib/firebase'
import Link from 'next/link'
import Navbar from "../components/Navbar.js"
import { format, parseISO } from 'date-fns'
import { makeCommaSeparatedString } from '../lib/makeCommaSeparatedString'
import { useState } from 'react';

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
            <Navbar />
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-4 p-8">
                    {allArticleData.map(({ id, date, author, title, tags, blurb, imageUrl, size }, index) => {
                        let spanClasses = '';
                        let imageHeight = 'h-48';
                        console.log(size);
                        switch (size) {
                            case 'large':
                                spanClasses = 'col-span-2 lg:col-span-2 row-span-2';
                                imageHeight = 'h-96';
                                break;
                            case 'normal':
                                spanClasses = 'col-span-2 row-span-1';
                                imageHeight = 'h-64';
                                break;
                            case 'medium':
                                spanClasses = 'col-span-1 row-span-1';
                                break;
                            default:
                                spanClasses = 'col-span-1 row-span-1';
                                break;
                        }

                        return (
                            <div key={index} className={`flex flex-col break-inside-avoid mb-6 ${spanClasses} max-w-sm mx-auto`}>
                                <Link href={`/posts/${id}`} className="block bg-white border border-slate-200 rounded-lg shadow-md hover:shadow-lg overflow-hidden">
                                    <div>
                                        {imageUrl && (
                                            <img src={imageUrl} alt={`Cover image for ${title}`} className={`w-full object-cover ${imageHeight}`} />
                                        )}
                                        <div className="p-3">
                                            <h5 className="leading-snug text-lg font-semibold tracking-tight text-gray-900 dark:text-white">{title}</h5>
                                            <h5 className="mb-1 text-sm tracking-tight text-gray-500 dark:text-white">By {makeCommaSeparatedString(author)} | {format(parseISO(date), 'LLLL d, yyyy')}</h5>
                                            <p className="text-sm text-gray-700 dark:text-gray-400">{blurb}</p>
                                        </div>
                                    </div>
                                </Link>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

export async function getServerSideProps() {
    const allArticleData = await getAllArticleData();
    return {
        props: {
            allArticleData,
        },
    };
}
