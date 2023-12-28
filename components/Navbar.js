import {useState} from 'react'
import {Dialog} from '@headlessui/react'
import {Bars3Icon, XMarkIcon} from '@heroicons/react/24/outline'
import Logo from './Logo.js'
import Link from "next/link"
import {useRouter} from 'next/router';
import {SearchBar} from "./SearchBar";
// import MobileLogo from './MobileLogo.js'

const navigation = [
    {name: 'Local', href: '/category/local'},
    {name: 'A&E', href: '/category/ae'},
    {name: 'News', href: '/category/news'},
    {name: 'Opinion', href: '/category/opinion'},
    {name: 'Creative', href: '/category/creative'},
    {name: 'Sports', href: '/category/sports'},
    {name: 'Humans of BASIS', href: '/category/hob'},
    {name: 'About Us', href: '/about'}
]


export default function Navbar() {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const router = useRouter();

    return (
        <div className="px-6 pt-6 lg:px-8">
            <Logo className="hidden lg:block"/>
            <div>
                <nav className="flex h-16 items-center justify-center space-x-1" aria-label="Global">
                    <div className="flex lg:hidden">
                        <button
                            type="button"
                            className="-m-2.5 inline-flex items-center justify-center rounded-md p-2.5 text-gray-700"
                            onClick={() => setMobileMenuOpen(true)}
                        >
                            <span className="sr-only">Open Navigation Menu</span>
                            <Bars3Icon className="h-6 w-6" aria-hidden="true"/>
                        </button>
                    </div>
                    <Logo className="flex lg:hidden px-2 justify-center h-16"
                          style={{width: '100%', height: '100%', position: 'relative'}}/>
                    <div
                        className="hidden xl:mt-4 lg:flex lg:min-w-0 lg:flex-1 lg:mb-4 lg:justify-center lg:items-center lg:gap-x-6 xl:gap-x-10 px-20 xl:pt-5">
                        {navigation.map((item) => (
                            <div
                                key={item.name}
                                className={`lg:text-lg xl:text-xl font-semibold ${router.asPath === item.href ? 'underline text-yellow-500' : 'text-gray-900'} hover:text-gray-500 lg:px-1 xl:px-2`}
                            >
                                <Link href={item.href}>
                                    <span>
                                      <span className="xl:hidden">
                                        {item.name === 'Humans of BASIS' ? 'HoB' : item.name === 'About Us' ? 'About' : item.name}
                                      </span>
                                      <span className="hidden xl:inline">
                                        {item.name}
                                      </span>
                                    </span>
                                </Link>
                            </div>
                        ))}
                        {/* Search Bar */}
                        <SearchBar className="hidden lg:block"/>
                    </div>
                </nav>

                <Dialog as="div" open={mobileMenuOpen} onClose={setMobileMenuOpen}>
                    <Dialog.Panel focus="true"
                                  className="fixed inset-0 z-10 overflow-y-auto bg-white px-6 py-6 lg:hidden">
                        <div className="flex h-16 items-center justify-center space-x-1">
                            <div className="flex">
                                <button
                                    type="button"
                                    className="-m-2.5 inline-flex items-center justify-center rounded-md p-2.5 text-gray-700"
                                    onClick={() => setMobileMenuOpen(false)}
                                >
                                    <span className="sr-only">Close menu</span>
                                    <XMarkIcon className="h-6 w-6" aria-hidden="true"/>
                                </button>
                            </div>
                            <Logo className="flex lg:hidden pt-1 px-2 justify-center h-16"
                                  style={{width: '100%', height: '100%', position: 'relative'}}/>

                        </div>
                        <div className="mt-5 flow-root">
                            <div className="divide-y divide-gray-500">
                                <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3">
                                    {navigation.map((item) => (
                                        <Link key={item.name} href={item.href} className="text-xl hover:bg-gray-50 block px-3 py-2 rounded-md font-medium">
                                            {item.name}
                                        </Link>
                                    ))}
                                    <SearchBar isIconOnly={false} className="-mt-2"/>
                                </div>
                            </div>
                        </div>
                    </Dialog.Panel>
                </Dialog>
            </div>
        </div>
    );
}

