import Link from 'next/link';

const INSTAGRAM_URL = 'https://www.instagram.com/_the_yellow_pages_/';

export default function PublicFooter() {
    return (
        <footer className="mt-auto border-t-4 border-yellow-300 bg-slate-950 text-white">
            <div className="mx-auto grid max-w-7xl gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)] lg:px-10 lg:py-12">
                <div className="max-w-xl">
                    <p className="text-xs font-bold uppercase tracking-[0.32em] text-yellow-300">
                        The Yellow Pages
                    </p>
                    <p className="mt-4 max-w-lg text-base leading-7 text-slate-300">
                        Student journalism from BASIS Independent Fremont.
                    </p>
                </div>

                <nav aria-label="Publication" className="grid content-start gap-3 text-sm font-semibold">
                    <p className="mb-1 text-xs font-bold uppercase tracking-[0.24em] text-slate-500">Publication</p>
                    <Link href="/issues" className="w-fit text-slate-200 transition hover:text-yellow-300">Issues</Link>
                    <Link href="/staff" className="w-fit text-slate-200 transition hover:text-yellow-300">Staff</Link>
                    <Link href="/about" className="w-fit text-slate-200 transition hover:text-yellow-300">About</Link>
                </nav>

                <div className="content-start">
                    <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500">Contact</p>
                    <p className="mt-4 text-sm leading-6 text-slate-300">
                        Have a correction, question or story idea?
                    </p>
                    <a
                        href={INSTAGRAM_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-block text-sm font-bold text-yellow-300 transition hover:text-yellow-200 hover:underline"
                    >
                        Message the staff on Instagram <span aria-hidden="true">↗</span>
                    </a>
                </div>
            </div>
            <div className="border-t border-white/10">
                <p className="mx-auto max-w-7xl px-5 py-5 text-xs text-slate-500 sm:px-8 lg:px-10">
                    © {new Date().getFullYear()} The Yellow Pages
                </p>
            </div>
        </footer>
    );
}
