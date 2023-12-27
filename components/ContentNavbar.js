import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FiSearch } from 'react-icons/fi';
import { Bars3Icon } from '@heroicons/react/24/outline';
import { LogoIcon } from './Logo';
import {SearchOverlay} from "./SearchOverlay";

const navigation = [
    { name: 'Local', href: '/category/local'},
    { name: 'A&E', href: '/category/ae' },
    { name: 'News', href: '/category/news' },
    { name: 'Opinion', href: '/category/opinion' },
    { name: 'Creative', href: '/category/creative' },
    { name: 'Sports', href: '/category/sports' },
    { name: 'Humans of BASIS', href: '/category/hob' },
    { name: 'About Us', href: '/about' }
];

export default function ContentNavbar() {
    const [isSearchOverlayOpen, setIsSearchOverlayOpen] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const router = useRouter();

    const toggleSearchOverlay = () => {
        setIsSearchOverlayOpen(!isSearchOverlayOpen);
    }

    return (
        <div className="pt-16">
            <nav className="fixed top-0 left-0 w-full z-50 bg-white shadow">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between h-16">
                        <div className="flex">
                            <div className="-ml-2 mr-2 flex items-center md:hidden">
                                <button
                                    onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                                    className="inline-flex items-center justify-center p-2 rounded-md text-gray-700 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:bg-gray-100 focus:text-gray-500"
                                    aria-label="Main menu"
                                >
                                    <Bars3Icon className="block h-6 w-6" />
                                </button>
                            </div>
                            <div className="flex-shrink-0 flex items-center">
                                <Link href="/">
                                    <a>
                                        <LogoIcon className="block lg:hidden h-8 w-auto" alt="Logo" />
                                    </a>
                                </Link>
                            </div>
                            <div className="items-center hidden md:ml-6 md:flex md:space-x-8">
                                {navigation.map((item) => (
                                    <Link key={item.name} href={item.href}>
                                        <a className="text-gray-900 hover:text-gray-700 px-3 py-2 rounded-md text-sm font-medium">
                                            {item.name}
                                        </a>
                                    </Link>
                                ))}
                            </div>
                        </div>
                        <div className="flex items-center">
                            <div className="flex-shrink-0">
                                <button
                                    onClick={toggleSearchOverlay}
                                    className="bg-white p-1 border-0 text-gray-600 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                                >
                                    <FiSearch className="h-6 w-6" aria-hidden="true" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {mobileMenuOpen && (
                    <div className="md:hidden">
                        <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3">
                            {navigation.map((item) => (
                                <Link key={item.name} href={item.href}>
                                    <a className="text-gray-700 hover:bg-gray-50 block px-3 py-2 rounded-md text-base font-medium">
                                        {item.name}
                                    </a>
                                </Link>
                            ))}
                        </div>
                    </div>
                )}

                {/* Full Page Search Overlay */}
                <SearchOverlay isOpen={isSearchOverlayOpen} onClose={toggleSearchOverlay}/>
            </nav>
        </div>
    );
}
