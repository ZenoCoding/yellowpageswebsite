import {useState} from 'react'
import {Dialog} from '@headlessui/react'
import {Bars3Icon, XMarkIcon} from '@heroicons/react/24/outline'
import Logo from './Logo.js'
import Link from "next/link"
import {useRouter} from 'next/router';
import {FiSearch} from "react-icons/fi";
import {SearchOverlay} from "./SearchOverlay";
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

  console.log("router pathname: " + router.asPath);

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
              <Link href="/">
                <img src='/images/yellowPages5.png' width="2672" height="332" className="mx-auto"
                     style={{height: "100%", width: "100%", objectFit: "contain"}}/>
              </Link>
            </div>
            <div className="hidden lg:flex lg:min-w-0 lg:flex-1 lg:mb-4 lg:justify-center lg:gap-x-12">
              {navigation.map((item) => (
                  <div
                      className={`lg:text-xl xl:text-2xl font-semibold ${router.asPath === item.href ? ' underline text-yellow-500' : 'text-gray-900'} hover:text-gray-500 `}>
                    <Link key={item.name} href={item.href}>
                      {item.name}
                    </Link>
                  </div>
              ))}
            </div>
          </nav>

          <Dialog as="div" open={mobileMenuOpen} onClose={setMobileMenuOpen}>
            <Dialog.Panel focus="true" className="fixed inset-0 z-10 overflow-y-auto bg-white px-6 py-6 lg:hidden">
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
                <div className="flex lg:hidden pt-1 px-2 justify-center max-h-full"
                     style={{width: '100%', height: '100%', position: 'relative'}}>
                  <Link href="/">
                    <img src='/images/yellowPages5.png' width="2672px" height="332px"
                         className="mx-auto"
                         style={{height: "100%", width: "100%", objectFit: "contain"}}/>
                  </Link>
                </div>

              </div>
              <div className="mt-6 flow-root">
                <div className="-my-6 divide-y divide-gray-500/10">
                  <div className="space-y-2 py-6">
                    {navigation.map((item) => (
                        <div className="text-2xl -mx-3 block rounded-lg py-4 px-3 font-semibold leading-7 text-gray-900 hover:bg-gray-400/10">
                          <Link key={item.name} href={item.href}>
                            {item.name}
                          </Link>
                        </div>
                    ))}
                    <div
                        className="text-2xl -mx-3 block rounded-lg py-4 px-3 font-semibold leading-7 text-gray-900 hover:bg-gray-400/10 flex items-center">
                      <FiSearch size={24}/>
                      <button onClick={toggleSearchOverlay} className="z-30 border-0 ml-2">
                        Search
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </Dialog.Panel>
          </Dialog>
          {/* Search Icon */}
          {!mobileMenuOpen && <button onClick={toggleSearchOverlay} className="absolute top-5 right-5 z-30 border-0">
            <FiSearch size={24}/>
          </button>}

          {/* Full Page Search Overlay */}
          <SearchOverlay isOpen={isSearchOverlayOpen} onClose={toggleSearchOverlay}/>
        </div>
      </div>
  );
}

