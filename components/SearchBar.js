import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { FiSearch } from 'react-icons/fi';
import { motion } from 'framer-motion';

export function SearchBar({ className, isIconOnly = true }) {
    const [searchTerm, setSearchTerm] = useState('');
    const [isActive, setIsActive] = useState(false);
    const router = useRouter();

    const searchBarRef = useRef(); // Ref for the search bar container
    const searchIconRef = useRef(); // Ref for the search icon

    const handleSearchChange = (event) => {
        setSearchTerm(event.target.value);
    };

    const handleSearchSubmit = (event) => {
        event.preventDefault();
        router.push(`/search?query=${searchTerm}`);
        setIsActive(false); // Close the search bar
    };

    const toggleSearch = () => {
        setIsActive(!isActive);
        if (isActive) setSearchTerm(''); // Clear searchTerm only when closing the search bar
    };

    // Effect to close search bar when clicking outside
    useEffect(() => {
        const closeSearch = (event) => {
            if (isActive && searchBarRef.current && !searchBarRef.current.contains(event.target) && !searchIconRef.current.contains(event.target)) {
                setIsActive(false);
            }
        };

        // Add event listener for clicks
        document.addEventListener('mousedown', closeSearch);
        return () => {
            // Clean up event listener
            document.removeEventListener('mousedown', closeSearch);
        };
    }, [isActive]);

    return (
        <div className="relative">
            <div ref={searchBarRef} className={`${className} flex items-center z-50 pb-3 ${isIconOnly ? "pl-4" : ""} block px-3 py-2`}>
                <div className="flex items-center">
                    <button ref={searchIconRef} onClick={toggleSearch} className={`${isIconOnly || "flex items-center"}  border-0 text-xl font-medium`}>
                        <FiSearch size={24} className="mr-2"/>
                        {!isIconOnly &&
                            <motion.div
                                initial={{opacity: 1, scale: 1, width: "auto"}}
                                animate={{
                                    opacity: isActive ? 0 : 1,
                                    scale: isActive ? 0.8 : 1,
                                    width: isActive ? 0 : "auto"
                                }}
                                transition={{duration: 0.2}}
                            >
                                <span className={`text-black ${isActive ? "hidden" : "block"}`}>Search</span>
                            </motion.div>}
                    </button>
                    <motion.div
                        initial={false}
                        animate={{
                            width: isActive ? 250 : 0,
                            padding: isActive ? "0" : "250",
                        }}
                        transition={{duration: 0.3}}
                        className="overflow-hidden flex items-center"
                    >
                        <form onSubmit={handleSearchSubmit} className={`border-b-2 border-black`}>
                            <input
                                type="text"
                                placeholder="Search for anything..."
                                value={searchTerm}
                                onChange={handleSearchChange}
                                className={`w-full border-none bg-transparent py-2 text-gray-700 focus:outline-none transition-all duration-200 ease-in-out `}
                            />
                        </form>
                        <button
                            type="submit"
                            className={`ml-2 bg-transparent text-black border-black p-2 rounded-xl font-bold hover:bg-black hover:text-white transition-all duration-200 ease-in-out px-4`}
                        >
                            Go
                        </button>
                    </motion.div>
                </div>
            </div>
        </div>
    );
}
