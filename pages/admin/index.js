import Head from 'next/head';
import Link from 'next/link';
import {useMemo} from 'react';
import {
    ArrowRightIcon,
    BookOpenIcon,
    DocumentPlusIcon,
    InboxStackIcon,
    PhotoIcon,
    UsersIcon,
} from '@heroicons/react/24/outline';
import ContentNavbar from '../../components/ContentNavbar';
import NoAuth from '../../components/auth/NoAuth';
import {useUser} from '../../firebase/useUser';
import {getAdmins} from '../../lib/firebase';

const NEWSROOM_ACTIONS = [
    {
        eyebrow: 'Intake',
        title: 'Import queue',
        description: 'Review and prepare Drive submissions.',
        href: '/admin/newsroom',
        icon: InboxStackIcon,
        cta: 'Review submissions',
        featured: true,
    },
    {
        eyebrow: 'Write',
        title: 'New article',
        description: 'Start a story from scratch.',
        href: '/upload',
        icon: DocumentPlusIcon,
        cta: 'Create an article',
    },
    {
        eyebrow: 'Editions',
        title: 'Issue archive',
        description: 'Plan and publish editions.',
        href: '/admin/issues',
        icon: BookOpenIcon,
        cta: 'Manage issues',
    },
    {
        eyebrow: 'People',
        title: 'Staff directory',
        description: 'Manage bylines and profiles.',
        href: '/admin/authors',
        icon: UsersIcon,
        cta: 'Manage staff',
    },
    {
        eyebrow: 'Archive',
        title: 'Greyscale & media',
        description: 'Prepare and browse photography.',
        href: '/greyscale',
        icon: PhotoIcon,
        cta: 'Browse the archive',
    },
];

function ActionCard({action}) {
    const Icon = action.icon;

    if (action.featured) {
        return (
            <Link
                href={action.href}
                className="group relative overflow-hidden rounded-2xl bg-yellow-300 p-7 text-slate-900 transition hover:bg-yellow-200 sm:p-9 lg:col-span-2"
            >
                <div className="relative z-10 flex h-full flex-col justify-between gap-10 sm:flex-row sm:items-end">
                    <div className="max-w-xl">
                        <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-700">
                            <Icon aria-hidden="true" className="h-5 w-5"/>
                            {action.eyebrow}
                        </span>
                        <h2 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">{action.title}</h2>
                        <p className="mt-4 max-w-lg text-base leading-7 text-slate-700">{action.description}</p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-2 text-sm font-bold">
                        {action.cta}
                        <ArrowRightIcon aria-hidden="true" className="h-5 w-5 transition group-hover:translate-x-1"/>
                    </span>
                </div>
            </Link>
        );
    }

    return (
        <Link
            href={action.href}
            className="group flex min-h-[12rem] flex-col justify-between rounded-2xl border border-slate-200 bg-white p-7 transition hover:border-slate-500"
        >
            <div>
                <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{action.eyebrow}</span>
                    <span className="rounded-full bg-slate-100 p-3 text-slate-700 transition group-hover:bg-yellow-200 group-hover:text-slate-900">
                        <Icon aria-hidden="true" className="h-6 w-6"/>
                    </span>
                </div>
                <h2 className="mt-8 text-2xl font-bold tracking-tight text-slate-900">{action.title}</h2>
                <p className="mt-3 text-sm leading-6 text-slate-600">{action.description}</p>
            </div>
            <span className="mt-7 inline-flex items-center gap-2 text-sm font-bold text-slate-900">
                {action.cta}
                <ArrowRightIcon aria-hidden="true" className="h-4 w-4 transition group-hover:translate-x-1"/>
            </span>
        </Link>
    );
}

export default function AdminDashboard({admins}) {
    const {user} = useUser();
    const adminIdSet = useMemo(() => new Set(Array.isArray(admins) ? admins : []), [admins]);
    const isAdmin = Boolean(user) && adminIdSet.has(user.id);
    if (!user) {
        return <NoAuth/>;
    }
    if (!isAdmin) {
        return <NoAuth permission={true}/>;
    }

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900">
            <Head>
                <title>Newsroom | The Yellow Pages</title>
                <meta
                    name="description"
                    content="The Yellow Pages newsroom."
                />
            </Head>
            <ContentNavbar/>

            <main>
                <section className="border-b border-slate-200 bg-white">
                    <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-16 lg:px-10">
                        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
                            <div className="max-w-3xl">
                                <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-600">The Yellow Pages</p>
                                <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-6xl">Newsroom</h1>
                            </div>
                            <Link
                                href="/"
                                className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 transition hover:border-slate-900 hover:bg-slate-900 hover:text-white"
                            >
                                View front page
                                <ArrowRightIcon aria-hidden="true" className="h-4 w-4"/>
                            </Link>
                        </div>
                    </div>
                </section>

                <section className="mx-auto max-w-7xl px-5 py-10 sm:px-8 sm:py-14 lg:px-10">
                    <div className="mb-7 flex items-end justify-between gap-5">
                        <div>
                            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Workspaces</h2>
                        </div>
                    </div>

                    <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
                        {NEWSROOM_ACTIONS.map((action) => (
                            <ActionCard key={action.title} action={action}/>
                        ))}
                    </div>
                </section>

            </main>
        </div>
    );
}

export async function getServerSideProps() {
    const admins = await getAdmins();

    return {
        props: {
            admins: admins.admins,
        },
    };
}
