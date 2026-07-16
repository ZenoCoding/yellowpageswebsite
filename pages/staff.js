import Head from 'next/head';
import Link from 'next/link';
import Navbar from '../components/Navbar.js';
import {getAuthorDirectoryForServer} from '../lib/firebase';

const POSITION_ORDER = [
    'Editor-in-Chief',
    'Managing Editor',
    'News Editor',
    'Feature Editor',
    'Sports Editor',
    'Opinion Editor',
    'A&E Editor',
    'Copy Editor',
    'Photo Editor',
    'Multimedia Editor',
    'Staff Writer',
    'Guest Contributor',
];

const positionRank = (position) => {
    const index = POSITION_ORDER.indexOf(position);
    return index === -1 ? POSITION_ORDER.length : index;
};

const sortStaff = (a, b) => {
    const roleDifference = positionRank(a.position) - positionRank(b.position);
    return roleDifference || a.fullName.localeCompare(b.fullName);
};

const initialsFromName = (name) => name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'YP';

const profileHref = (person) => `/authors/${encodeURIComponent(person.authorSlug || person.id)}`;

const PersonCard = ({person}) => (
    <Link
        href={profileHref(person)}
        className="group grid grid-cols-[5rem_minmax(0,1fr)] gap-4 border-t border-slate-300 py-5 transition hover:border-yellow-500 sm:grid-cols-[6rem_minmax(0,1fr)]"
    >
        <div className="flex h-20 w-20 items-center justify-center overflow-hidden bg-yellow-100 sm:h-24 sm:w-24">
            {person.photoUrl ? (
                <img
                    src={person.photoUrl}
                    alt={`Portrait of ${person.fullName}`}
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                    loading="lazy"
                    decoding="async"
                />
            ) : (
                <span className="text-xl font-black tracking-tight text-yellow-800">
                    {initialsFromName(person.fullName)}
                </span>
            )}
        </div>
        <div className="min-w-0 pt-1">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-yellow-700">
                {person.position || 'Staff'}
            </p>
            <h3 className="mt-2 text-xl font-black leading-tight tracking-tight text-slate-900 group-hover:text-yellow-700 sm:text-2xl">
                {person.fullName}
            </h3>
            {person.graduationYear && (
                <p className="mt-2 text-sm text-slate-500">Class of {person.graduationYear}</p>
            )}
            {person.bio && (
                <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">{person.bio}</p>
            )}
        </div>
    </Link>
);

export default function StaffPage({editors, staff, alumni}) {
    const hasCurrentStaff = editors.length + staff.length > 0;

    return (
        <div className="min-h-screen bg-white text-slate-900">
            <Head>
                <title>Staff | The Yellow Pages</title>
                <meta
                    name="description"
                    content="Meet the student journalists behind The Yellow Pages at BASIS Independent Fremont."
                />
                <meta property="og:title" content="Staff | The Yellow Pages"/>
                <meta
                    property="og:description"
                    content="Meet the student journalists behind The Yellow Pages at BASIS Independent Fremont."
                />
            </Head>
            <Navbar/>

            <main className="mx-auto max-w-7xl px-5 pb-20 pt-10 sm:px-8 sm:pt-14 lg:px-10">
                <header className="border-y-4 border-slate-900 py-8 sm:py-10">
                    <p className="text-xs font-bold uppercase tracking-[0.35em] text-yellow-700">The masthead</p>
                    <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_28rem] lg:items-end">
                        <h1 className="text-4xl font-black tracking-tight sm:text-6xl">Staff</h1>
                        <p className="max-w-xl text-base leading-7 text-slate-600 lg:justify-self-end">
                            The students who report, write, edit, photograph and publish The Yellow Pages.
                        </p>
                    </div>
                </header>

                {hasCurrentStaff ? (
                    <div className="mt-12 grid gap-x-12 gap-y-14 lg:grid-cols-2">
                        {editors.length > 0 && (
                            <section aria-labelledby="editors-heading">
                                <div className="border-b-2 border-slate-900 pb-3">
                                    <h2 id="editors-heading" className="text-sm font-black uppercase tracking-[0.28em]">Editors</h2>
                                </div>
                                <div>{editors.map((person) => <PersonCard key={person.id} person={person}/>)}</div>
                            </section>
                        )}

                        {staff.length > 0 && (
                            <section aria-labelledby="staff-heading">
                                <div className="border-b-2 border-slate-900 pb-3">
                                    <h2 id="staff-heading" className="text-sm font-black uppercase tracking-[0.28em]">Staff and contributors</h2>
                                </div>
                                <div>{staff.map((person) => <PersonCard key={person.id} person={person}/>)}</div>
                            </section>
                        )}
                    </div>
                ) : (
                    <section className="mt-12 border border-slate-200 bg-slate-50 px-6 py-12 text-center">
                        <h2 className="text-2xl font-bold">The current masthead is being updated.</h2>
                    </section>
                )}

                {alumni.length > 0 && (
                    <section className="mt-16 border-t-4 border-slate-900 pt-7" aria-labelledby="alumni-heading">
                        <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-[0.28em] text-yellow-700">The archive</p>
                                <h2 id="alumni-heading" className="mt-3 text-3xl font-black tracking-tight">Past staff</h2>
                            </div>
                            <ul className="grid list-none gap-x-8 border-t border-slate-300 p-0 sm:grid-cols-2 lg:border-t-0">
                                {alumni.map((person) => (
                                    <li key={person.id} className="border-b border-slate-200 py-4">
                                        <Link href={profileHref(person)} className="group block">
                                            <span className="font-bold text-slate-900 group-hover:text-yellow-700">{person.fullName}</span>
                                            <span className="mt-1 block text-sm text-slate-500">
                                                {[person.position, person.graduationYear ? `Class of ${person.graduationYear}` : ''].filter(Boolean).join(' · ') || 'Past contributor'}
                                            </span>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </section>
                )}

                <section className="mt-16 border-y border-slate-900 bg-yellow-300 px-6 py-8 sm:px-9">
                    <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                        <div>
                            <h2 className="text-2xl font-black tracking-tight">Corrections and story ideas</h2>
                            <p className="mt-2 text-base leading-7 text-slate-700">
                                Readers can reach the newspaper staff through its official Instagram account.
                            </p>
                        </div>
                        <a
                            href="https://www.instagram.com/_the_yellow_pages_/"
                            target="_blank"
                            rel="noreferrer"
                            className="w-fit border-2 border-slate-900 bg-slate-900 px-5 py-3 text-sm font-bold text-white transition hover:bg-white hover:text-slate-900"
                        >
                            Contact the staff <span aria-hidden="true">↗</span>
                        </a>
                    </div>
                </section>
            </main>
        </div>
    );
}

export async function getServerSideProps() {
    const directory = await getAuthorDirectoryForServer();
    const today = new Date();
    const graduationCutoffYear = today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
    const people = Array.from(directory.values())
        .filter((person) => person?.id && !person.isHidden && typeof person.fullName === 'string' && person.fullName.trim())
        .map((person) => ({
            id: person.id,
            fullName: person.fullName.trim(),
            photoUrl: typeof person.photoUrl === 'string' ? person.photoUrl : null,
            graduationYear: Number.isInteger(person.graduationYear) ? person.graduationYear : null,
            position: typeof person.position === 'string' && person.position.trim() ? person.position.trim() : 'Staff Writer',
            bio: typeof person.bio === 'string' && person.bio.trim() ? person.bio.trim() : null,
            authorSlug: typeof person.authorSlug === 'string' && person.authorSlug.trim() ? person.authorSlug.trim() : null,
            isAlumni: Boolean(person.hasDeparted) || (Number.isInteger(person.graduationYear) && person.graduationYear <= graduationCutoffYear),
        }));

    const currentStaff = people.filter((person) => !person.isAlumni).sort(sortStaff);
    const alumni = people
        .filter((person) => person.isAlumni)
        .sort((a, b) => (b.graduationYear || 0) - (a.graduationYear || 0) || a.fullName.localeCompare(b.fullName));

    return {
        props: {
            editors: currentStaff.filter((person) => /editor/i.test(person.position)),
            staff: currentStaff.filter((person) => !/editor/i.test(person.position)),
            alumni,
        },
    };
}
