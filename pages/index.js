import { getAllArticleData  } from '../lib/firebase'
import Link from 'next/link'
import Navbar from "../components/Navbar.js"
import { parseISO, format } from 'date-fns'
import { makeCommaSeparatedString } from '../lib/makeCommaSeparatedString'

export default function Home({ allArticleData }) {
  return (
    // <Layout home>
    <div className="bg-white">
      <Navbar/>
      <div className="mx-auto justify-center max-w-2xl px-4 sm:px-6 lg:max-w-7xl lg:px-8">
        {/* <h2 className="sr-only">Art Pieces</h2> */}
        <div className="columns-1 md:columns-2 lg:columns-3 gap-4 space-y-4 p-8">
        {/* <div class="grid gap-y-10 gap-x-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 xl:gap-x-8"> */}
          {/* <a href="#" className="group"> */}
          
            {/* <h3 className="mt-4 text-sm text-gray-700">Xacto Blades, Goblet, Altered Shadow</h3>
            <p className="mt-1 text-lg font-medium text-gray-900">Tsunami Blades</p> */}
          {allArticleData.map(({ id, date, author, title, tags, blurb }) => (
            <div className="h-min w-full max-w-sm overflow-hidden rounded-lg bg-gray-200 mx-auto">
            <Link href={`/posts/${id}`} legacyBehavior> 
              <a className="block max-w-sm p-3 bg-white border border-slate-700 rounded-lg shadow-md hover:bg-gray-100 hover:no-underline dark:bg-gray-800 dark:border-gray-700 dark:hover:bg-gray-700">
                  <h5 className="leading-snug text-lg font-semibold tracking-tight text-gray-900 dark:text-white">{title}</h5>
                  <h5 className="mb-0.5 text-sm tracking-tight text-gray-500 dark:text-white">By {makeCommaSeparatedString(author)} | {format(parseISO(date), 'LLLL d, yyyy')}</h5>
                  <p className="mb-0.5 text-sm text-gray-700 dark:text-gray-400">{blurb}</p>
              </a>
            </Link>
          </div>
          ))}
            {/* <h3 className="mt-4 text-sm text-gray-700">Charcoal</h3>
            <p className="mt-1 text-lg font-medium text-gray-900">Monte Cristo Bust</p>
          </a> */}

        </div>
      </div>
    </div>
  );
}

export async function getServerSideProps() {
  const allArticleData = await getAllArticleData()
  return {
    props: {
      allArticleData
    }
  }
}
