import Link from 'next/link'
import Date from '../components/date'
import yellowPages5 from '../public/images/yellowPages5.png'
import Image from "next/image"
import Navbar from "../components/Navbar.js"
import { parseISO, format } from 'date-fns'
import { makeCommaSeparatedString } from '../lib/makeCommaSeparatedString'
// https://tailwind-elements.com/docs/standard/components/social-buttons/
export default function About() {
  return (
    // <Layout home>
    <div className="bg-white">
        <Navbar/>
      <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:max-w-7xl lg:px-8">
        {/* <h2 className="sr-only">Art Pieces</h2> */}
        
        <div className="max-w-3xl mx-auto text-center text-lg mt-7">
        <p>The Yellow Pages is Basis Independent Fremont’s school newspaper, featuring engaging and relevant articles monthly (including but not limited to school events, current affairs, and entertainment). Being on the paper’s staff provides students with crucial life experiences, such as researching and developing communication skills with others. Members not only learn what it’s like to be part of a newspaper, but they also hone their writing skills, allowing them to grow in and outside of the classroom. </p>
        <div className="px-2 justify-center h-72">
            {/* <a href="/"> */}
            <img src='/images/yellowpages.png' className = "object-contain h-full w-full"/>
            {/* </a>  */}
        </div>
        <br></br>
        </div>
        </div>
        </div>
  );
}
