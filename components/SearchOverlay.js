import {useEffect, useState} from "react";
import {useRouter} from "next/router";
import {FiSearch} from "react-icons/fi";
import {FaPaperPlane} from "react-icons/fa";
import {XMarkIcon} from "@heroicons/react/24/outline";

export function SearchOverlay({isOpen, onClose}) {
    const [searchTerm, setSearchTerm] = useState('');
    const router = useRouter();

    const handleSearchChange = (event) => {
        setSearchTerm(event.target.value);
    };

    const handleSearchSubmit = (event) => {
        event.preventDefault();
        onClose(); // close the search overlay
        router.push(`/search?query=${searchTerm}`);
    };

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        // Clean up the event listener when the component is unmounted or when isOpen changes
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-white z-50 flex justify-center items-center">
            <div className="flex items-center space-x-4 max-w-xl w-full mx-auto px-4">
                <FiSearch size={40}/>
                <form onSubmit={handleSearchSubmit} className="flex flex-grow">
                    <input
                        autoFocus
                        type="text"
                        placeholder=" Type and hit enter to search..."
                        value={searchTerm}
                        onChange={handleSearchChange}
                        className="flex-grow border-b-2 border-gray-500 bg-transparent py-3 text-2xl text-gray-700 focus:outline-none"
                    />
                    <button type="submit"
                            className="flex items-center ml-4 bg-transparent border-1 border-black text-xl py-3 px-6 rounded-xl">
                        {/* Search Icon */}
                        <FaPaperPlane className="flex flex-grow mr-2"/>
                        Search
                    </button>
                    <button type="button" onClick={onClose}
                            className="absolute right-1 top-1 border-0 bg-transparent p-2">
                        <XMarkIcon className="h-8 w-8 text-gray-400" aria-hidden="true"/>
                    </button>
                </form>
            </div>
        </div>
    );

}