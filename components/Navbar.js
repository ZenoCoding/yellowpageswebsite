import { useState } from 'react'
import { Dialog } from '@headlessui/react'
import { Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline'
import Logo from './Logo.js'
import Link from "next/link"
import { useRouter } from 'next/router';
import {FiSearch} from "react-icons/fi";
// import MobileLogo from './MobileLogo.js'

const navigation = [
  { name: 'Local', href: '/category/local'},
  { name: 'A&E', href: '/category/ae' },
  { name: 'News', href: '/category/news' },
  { name: 'Opinion', href: '/category/opinion' },
  { name: 'Creative', href: '/category/creative' },
  { name: 'Sports', href: '/category/sports' },
  { name: 'Humans of BASIS', href: '/category/hob' },
  { name: 'About Us', href: '/about' }
]


export default function Navbar() {
  const [isSearchOverlayOpen, setIsSearchOverlayOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const router = useRouter();

  const toggleSearchOverlay = () => {
    setIsSearchOverlayOpen(!isSearchOverlayOpen);
  };

  return (
      <div className="px-6 pt-6 lg:px-8">
        <Logo/>
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
            <div className="flex lg:hidden pt-1 px-2 justify-center h-16"
                 style={{width: '100%', height: '100%', position: 'relative'}}>
              <a href="/">
                <img src='/images/yellowPages5.png' width="2672" height="332" className="mx-auto hover:opacity-60"
                     style={{height: "100%", width: "100%", objectFit: "contain"}}/>
              </a>
            </div>
            <div className="hidden lg:flex lg:min-w-0 lg:flex-1 lg:mb-4 lg:justify-center lg:gap-x-12">
              {navigation.map((item) => (
                  <a key={item.name} href={item.href}
                     className="lg:text-xl xl:text-2xl font-semibold text-gray-900 hover:text-gray-500 ">
                    {item.name}
                  </a>
              ))}
            </div>
          </nav>

          <Dialog as="div" open={mobileMenuOpen} onClose={setMobileMenuOpen}>
            <Dialog.Panel focus="true" className="fixed inset-0 z-10 overflow-y-auto bg-white px-6 py-6 lg:hidden">
              <div className="flex h-16 items-center justify-center justify-between space-x-1">
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
                <div className="flex lg:hidden pt-1 px-2 justify-center max-h-full"
                     style={{width: '100%', height: '100%', position: 'relative'}}>
                  <a href="/">
                    <img src='/images/yellowPages5.png' width="2672px" height="332px"
                         className="mx-auto hover:opacity-60"
                         style={{height: "100%", width: "100%", objectFit: "contain"}}/>
                  </a>
                </div>

              </div>
              <div className="mt-6 flow-root">
                <div className="-my-6 divide-y divide-gray-500/10">
                  <div className="space-y-2 py-6">
                    {navigation.map((item) => (
                        <Link
                            key={item.name}
                            href={item.href}
                            className="text-2xl -mx-3 block rounded-lg py-4 px-3 font-semibold leading-7 text-gray-900 hover:bg-gray-400/10"
                        >
                          {item.name}
                        </Link>
                    ))}
                  </div>
                </div>
              </div>
            </Dialog.Panel>
          </Dialog>
          {/* Search Icon */}
          <button onClick={toggleSearchOverlay} className="absolute top-5 right-5 z-30 border-0">
            <FiSearch size={24} />
          </button>

          {/* Full Page Search Overlay */}
          <SearchOverlay isOpen={isSearchOverlayOpen} onClose={toggleSearchOverlay} />
        </div>
      </div>
  );
}

export function SearchOverlay({ isOpen, onClose }) {
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

  if (!isOpen) return null;

  return (
      <div className="fixed inset-0 bg-white z-50 flex justify-center items-center">
        <div className="flex items-center space-x-4 max-w-xl w-full mx-auto px-4">
          <FiSearch size={40}/>
          <form onSubmit={handleSearchSubmit} className="flex flex-grow">
            <input
                autoFocus
                type="text"
                placeholder="Type and hit enter to search..."
                value={searchTerm}
                onChange={handleSearchChange}
                className="flex-grow border-b-2 border-gray-500 bg-transparent py-3 text-2xl text-gray-700 focus:outline-none"
            />
            <button type="submit" className="ml-4 bg-yellow-300 hover:bg-yellow-400 text-white font-bold py-3 px-6 rounded-xl border-0">
              Search
            </button>
            <button type="button" onClick={onClose} className="absolute right-1 top-1 border-0 bg-transparent p-2">
              <XMarkIcon className="h-8 w-8 text-gray-400" aria-hidden="true"/>
            </button>
          </form>
        </div>
      </div>
  );

}
