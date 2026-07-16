import Head from 'next/head';
import Link from 'next/link';
import Navbar from "../components/Navbar.js"

export default function About() {
    return (
        <div className="min-h-screen bg-white text-slate-900">
            <Head>
                <title>About | The Yellow Pages</title>
                <meta name="description" content="The student newspaper of BASIS Independent Fremont."/>
            </Head>
            <Navbar/>
            <main className="mx-auto max-w-3xl px-5 pb-20 pt-10 sm:px-8 sm:pt-14">
                <header className="border-b-4 border-slate-900 pb-5">
                    <h1 className="text-4xl font-black tracking-tight sm:text-5xl">About</h1>
                </header>
                <section className="py-9 sm:py-12">
                    <p className="text-lg leading-8 text-slate-700 sm:text-xl sm:leading-9">
                        The Yellow Pages is Basis Independent Fremont&rsquo;s school newspaper, featuring engaging and relevant
                        articles monthly (including but not limited to school events, current affairs, and
                        entertainment). Being on the paper&rsquo;s staff provides students with crucial life experiences, such
                        as researching and developing communication skills with others. Members not only learn what it&rsquo;s
                        like to be part of a newspaper, but they also hone their writing skills, allowing them to grow
                        in and outside of the classroom.
                    </p>
                    <div className="mx-auto mt-10 h-48 max-w-sm sm:h-56">
                        <img src="/images/yellowpages.png" alt="The Yellow Pages" className="h-full w-full object-contain"/>
                    </div>
                    <div className="mt-10 grid gap-4 border-y border-slate-300 py-6 sm:grid-cols-2">
                        <Link href="/staff" className="group block pr-4">
                            <p className="text-xs font-bold uppercase tracking-[0.22em] text-yellow-700">The masthead</p>
                            <p className="mt-2 text-lg font-black text-slate-900 group-hover:text-yellow-700">
                                Meet the staff <span aria-hidden="true">→</span>
                            </p>
                        </Link>
                        <a
                            href="https://www.instagram.com/_the_yellow_pages_/"
                            target="_blank"
                            rel="noreferrer"
                            className="group block border-t border-slate-200 pt-4 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0"
                        >
                            <p className="text-xs font-bold uppercase tracking-[0.22em] text-yellow-700">Corrections and story ideas</p>
                            <p className="mt-2 text-lg font-black text-slate-900 group-hover:text-yellow-700">
                                Contact the newspaper <span aria-hidden="true">↗</span>
                            </p>
                        </a>
                    </div>
                </section>
            </main>
        </div>
    );
}
