import { getArticleContent, getAllArticleIds } from '../../lib/firebase'
import Date from '../../components/date'
import Link from "next/link"
import { makeCommaSeparatedString } from '../../lib/makeCommaSeparatedString'

export default function Post({ content }) {
  const authorData = makeCommaSeparatedString(content.author, true);
  return (
      <div className="m-auto px-5 max-w-2xl my-10">
        <style jsx global>{`
        a {
          color: rgb(59 130 246);
        }
        a:hover {
          text-decoration: underline;
        }
      `}</style>
        <h1 className = "text-4xl mb-1">{content.title}</h1>
        <div className="text-gray-500">
          <Date dateString={content.date} />
        </div>
        <div className="text-gray-500 mb-4">
          By {authorData}
        </div>
        
        <div dangerouslySetInnerHTML={{ __html: content.contentHtml }} />
        <div className="hover:underline text-blue-500 mb-5">
          <Link href="/">
            <a>← Back</a>
          </Link>
        </div>
      </div>
  )
}

// export async function getStaticPaths() {
//   console.log("getting paths...")
//   const paths = await getAllArticleIds()
//   console.log(paths)
//   return {
//     paths,
//     fallback: false
//   }
// }

export async function getServerSideProps({ params }) {
  const content = await getArticleContent(params.id)
  console.log(content)
  return {
    props: {
      content
    }
  }
}
