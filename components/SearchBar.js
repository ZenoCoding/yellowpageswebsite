import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { FiSearch } from 'react-icons/fi';
import { motion } from 'framer-motion';

export default function SearchBar({ className, isIconOnly = true }) {
    const [searchTerm, setSearchTerm] = useState('');
    const [isActive, setIsActive] = useState(false);
    const router = useRouter();

    const searchBarRef = useRef(null);
    const searchIconRef = useRef(null);
    const inputRef = useRef(null);

    const handleSearchChange = (event) => {
        setSearchTerm(event.target.value);
    };

    const handleSearchSubmit = (event) => {
        event.preventDefault();
        const trimmedQuery = searchTerm.trim();
        if (!trimmedQuery) {
            return;
        }
        router.push(`/search?query=${encodeURIComponent(trimmedQuery)}`);
        if (isIconOnly) {
            setIsActive(false);
        }
    };

    const toggleSearch = () => {
        setIsActive((previous) => {
            const next = !previous;
            if (!next && isIconOnly) {
                setSearchTerm('');
            }
            return next;
        });
    };

    useEffect(() => {
        if (!router.isReady) return;
        const queryValue = typeof router.query?.query === 'string' ? router.query.query : '';
        setSearchTerm(queryValue);
    }, [router.isReady, router.query?.query]);

    useEffect(() => {
        if (isActive && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isActive]);

    useEffect(() => {
        const closeSearch = (event) => {
            if (!isActive) return;
            const barEl = searchBarRef.current;
            const iconEl = searchIconRef.current;
            if (
                barEl &&
                !barEl.contains(event.target) &&
                (!iconEl || !iconEl.contains(event.target))
            ) {
                setIsActive(false);
                if (isIconOnly) {
                    setSearchTerm('');
                }
            }
        };

        document.addEventListener('mousedown', closeSearch);
        return () => {
            document.removeEventListener('mousedown', closeSearch);
        };
    }, [isActive]);

    const handleKeyDown = (event) => {
        if (event.key === 'Escape') {
            setIsActive(false);
            if (isIconOnly) {
                setSearchTerm('');
            }
        }
    };

    return (
        <div className="relative">
            <div
                ref={searchBarRef}
                className={`${className ?? ''} flex items-center pb-3 ${isIconOnly ? 'pl-4' : ''} block px-3 py-2`}
            >
                <div className="flex items-center">
                    <button
                        ref={searchIconRef}
                        type="button"
                        onClick={toggleSearch}
                        className={`border-0 text-xl font-medium ${isIconOnly ? '' : 'flex items-center'}`}
                        aria-label="Toggle search"
                    >
                        <FiSearch size={24} className="mr-2" />
                        {!isIconOnly &&
                            <motion.div
                                initial={{opacity: 1, scale: 1, width: 'auto'}}
                                animate={{
                                    opacity: isActive ? 0 : 1,
                                    scale: isActive ? 0.8 : 1,
                                    width: isActive ? 0 : 'auto'
                                }}
                                transition={{duration: 0.4}}
                            >
                                <span className={`text-black text-lg ${isActive ? "hidden" : "block"}`}>Search</span>
                            </motion.div>
                        }
                    </button>
                    <motion.div
                        initial={false}
                        animate={{
                            width: isActive ? (isIconOnly ? '220px' : '280px') : '0px'
                        }}
                        transition={{duration: 0.4}}
                        className="overflow-hidden flex items-center"
                    >
                        <form
                            onSubmit={handleSearchSubmit}
                            className="flex items-center gap-2 border-b-2 border-black pr-1"
                            role="search"
                        >
                            <label htmlFor="navbar-search" className="sr-only">
                                Search articles
                            </label>
                            <input
                                id="navbar-search"
                                type="text"
                                placeholder="Search for anything..."
                                value={searchTerm}
                                onChange={handleSearchChange}
                                onKeyDown={handleKeyDown}
                                ref={inputRef}
                                className="w-full border-none bg-transparent py-2 text-gray-700 focus:outline-none transition-all duration-200 ease-in-out"
                            />
                            <button
                                type="submit"
                                className="ml-1 rounded-lg border border-transparent bg-yellow-400 px-3 py-1 text-sm font-semibold text-slate-900 transition hover:bg-yellow-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-500"
                            >
                                Go
                            </button>
                        </form>
                    </motion.div>
                </div>
            </div>
        </div>
    );
}
