import { useState } from 'react';
import { Dialog } from '@headlessui/react';
import { Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline';
import Logo from './Logo.js';
import Link from "next/link";
import { useRouter } from 'next/router';
import SearchBar from "./SearchBar";

const navigation = [
    {name: 'Local', href: '/category/local'},
    {name: 'A&E', href: '/category/ae'},
    {name: 'News', href: '/category/news'},
    {name: 'Opinion', href: '/category/opinion'},
    {name: 'Creative', href: '/category/creative'},
    {name: 'Sports', href: '/category/sports'},
    {name: 'Humans of BASIS', href: '/category/hob'},
    {name: 'About Us', href: '/about'}
];

export default function Navbar() {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const router = useRouter();

    return (
        <div className="lg:pt-10 md:pt-5 px-4 md:px-8">
            <div className="flex flex-col items-center w-full lg:items-start">
                <div className="flex w-full justify-between lg:justify-center items-center">
                    <button
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                        className="p-2 rounded-md text-gray-700 lg:hidden"
                        aria-label="Open menu"
                    >
                        <Bars3Icon className="h-6 w-6" />
                    </button>
                    <Logo/>
                    <div className="hidden lg:block" /> {/* Placeholder to keep logo centered */}
                </div>
                <div className="hidden lg:flex justify-center items-center space-x-6 w-full">
                    {navigation.map((item) => (
                        <Link key={item.name} href={item.href} className={`text-lg font-semibold ${router.asPath === item.href ? 'underline text-yellow-500' : 'text-gray-900'} hover:text-gray-500`}>
                            {item.name}
                        </Link>
                    ))}
                    <SearchBar className="hover:text-gray-500" isIconOnly={false}/>
                </div>

            </div>
            <Dialog as="div" open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)}>
                <Dialog.Panel className="fixed inset-0 z-10 overflow-y-auto bg-white p-6">
                    <div className="flex items-center justify-between">
                        <button
                            onClick={() => setMobileMenuOpen(false)}
                            className="p-2 rounded-md text-gray-700"
                            aria-label="Close menu"
                        >
                            <XMarkIcon className="h-6 w-6"/>
                        </button>
                        <Logo/>
                    </div>
                    <div className="mt-5">
                        {navigation.map((item) => (
                            <Link key={item.name} href={item.href}
                                  className="text-xl hover:bg-gray-50 block px-3 py-2 rounded-md font-medium">
                                {item.name}
                            </Link>
                        ))}
                        <SearchBar isIconOnly={false} />
                    </div>
                </Dialog.Panel>
            </Dialog>
        </div>
    );
}
