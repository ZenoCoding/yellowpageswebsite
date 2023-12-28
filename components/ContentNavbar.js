import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FiSearch } from 'react-icons/fi';
import { Bars3Icon } from '@heroicons/react/24/outline';
import { LogoIcon } from './Logo';
import {SearchBar} from "./SearchBar";

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
                    <div className="flex items-center lg:justify-start justify-between h-16">
                        <div className="lg:hidden flex items-center">
                            <button
                                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                                className="inline-flex items-center justify-center p-2 rounded-lg text-gray-700 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:bg-gray-100 focus:text-gray-500"
                                aria-label="Main menu"
                            >
                                <Bars3Icon className="block h-6 w-6"/>
                            </button>
                        </div>
                        <div className="flex-grow lg:flex-grow-0 mr-10">
                            <LogoIcon className="mx-auto h-8 w-auto" alt="Logo"/>
                        </div>
                        <div className="hidden lg:flex lg:items-center lg:space-x-8">
                            {navigation.map((item) => (
                                <Link key={item.name} href={item.href}>
                                    <a className="text-gray-900 hover:text-gray-700 px-3 py-2 rounded-lg text-sm font-medium">
                                        {item.name}
                                    </a>
                                </Link>
                            ))}
                        </div>
                        {/* Ensure there's an empty div to balance the flex spacing on medium screens and below */}
                        <div className="flex lg:hidden">
                            {/* This div acts as a spacer */}
                        </div>
                    </div>
                </div>


                {mobileMenuOpen && (
                    <div className="lg:hidden">
                        <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3">
                            {navigation.map((item) => (
                                <Link key={item.name} href={item.href}>
                                    <a className="text-xl hover:bg-gray-50 block px-3 py-2 rounded-md font-medium text-black">
                                        {item.name}
                                    </a>
                                </Link>
                            ))}
                            <SearchBar isIconOnly={false} className="-mt-2"/>
                        </div>
                    </div>
                )}

                <SearchBar className="fixed top-0 right-0 hidden lg:block"/>
            </nav>
        </div>
    );
}
