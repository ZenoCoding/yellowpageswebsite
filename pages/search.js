// pages/search.js
import { getAllArticleData } from '../lib/firebase';
import Link from "next/link";
import {makeCommaSeparatedString} from "../lib/makeCommaSeparatedString";
import {format, parseISO} from "date-fns";
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import ContentNavbar from "../components/ContentNavbar";

export default function Search({ allArticleData }) {
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const router = useRouter();

    useEffect(() => {
        if (router.query.query) {
            setSearchTerm(router.query.query);
        }
    }, [router.query]);

    useEffect(() => {
        const filteredArticles = allArticleData.filter((article) =>
            article.title.toLowerCase().includes(searchTerm.toLowerCase())
        );
        setSearchResults(filteredArticles);
    }, [searchTerm, allArticleData]);

    const handleSearchChange = (event) => {
        setSearchTerm(event.target.value);
        const filteredArticles = allArticleData.filter((article) =>
            article.title.toLowerCase().includes(searchTerm.toLowerCase()) || article.blurb.toLowerCase().includes(searchTerm.toLowerCase())
        );
        setSearchResults(filteredArticles);
    };

    return (
        <div className="bg-white">
            <ContentNavbar/>
            {/* Search Header */}
            <div className="mx-auto max-w-xl px-4 sm:px-6 lg:max-w-7xl lg:px-8 py-4">
                <h1 className="text-2xl font-bold text-gray-900">Search Results for: {searchTerm}</h1>
            </div>
            {/* Search Results */}
            <div className="mx-auto max-w-lg px-4 sm:px-6 lg:max-w-7xl lg:px-8">
                {searchResults.length > 0 ? (
                    searchResults.map(({id, date, author, title, tags, blurb, thumbnail}) => (
                        <div key={id} className="flex mb-8 bg-white shadow-lg rounded-lg overflow-hidden">
                            {thumbnail &&
                                <div className="thumbnail-container w-1/4">
                                    <img src={thumbnail} alt="Article thumbnail" className="object-cover"/>
                                </div>
                            }
                            <div className="content-column flex-1 p-4">
                                <time dateTime={date} className="block text-sm font-normal text-gray-500 mb-2">
                                    {format(parseISO(date), 'LLLL d, yyyy')}
                                </time>
                                <Link href={`/posts/${id}`}>
                                    <div className="article-link">
                                        <h5 className="article-title text-xl font-semibold hover:underline">{title}</h5>
                                        <p className="article-meta text-sm text-gray-500">By {makeCommaSeparatedString(author)}</p>
                                        <p className="article-blurb mt-2 text-gray-700">{blurb}</p>
                                    </div>
                                </Link>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="text-center py-4">
                        <p className="text-gray-700">No results found for "{searchTerm}".</p>
                    </div>
                )}
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