import Head from 'next/head';
import Link from 'next/link';
import {useMemo} from 'react';
import {ArrowRightIcon, DocumentPlusIcon, ListBulletIcon, UsersIcon} from '@heroicons/react/24/outline';
import ContentNavbar from '../../components/ContentNavbar';
import NoAuth from '../../components/auth/NoAuth';
import {useUser} from '../../firebase/useUser';
import {getAdmins} from '../../lib/firebase';

const PRIMARY_ACTIONS = [
    {
        title: 'Upload Article',
        description: 'Create a new story, attach media, and publish it to the homepage.',
        href: '/upload',
        icon: DocumentPlusIcon,
        accent: 'bg-indigo-100 text-indigo-600',
        cta: 'Open upload tool',
    },
    {
        title: 'Manage Staff',
        description: 'Update bios, roles, and availability so article credits stay accurate.',
        href: '/admin/authors',
        icon: UsersIcon,
        accent: 'bg-emerald-100 text-emerald-600',
        cta: 'Open staff directory',
    },
    {
        title: 'Edit Existing Articles',
        description: 'Search for a published piece and jump into the edit workflow.',
        href: '/editor',
        icon: ListBulletIcon,
        accent: 'bg-amber-100 text-amber-600',
        cta: 'Review content',
    },
];

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
        <div className="min-h-screen bg-slate-50">
            <Head>
                <title>Admin Dashboard</title>
            </Head>
            <ContentNavbar/>
            <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
                <header className="mb-12">
                    <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">Admin Tools</p>
                    <h1 className="mt-3 text-4xl font-bold text-slate-900 sm:text-5xl">
                        Welcome back, {user?.name || 'editor'}.
                    </h1>
                    <p className="mt-4 max-w-3xl text-lg text-slate-600">
                        Use these shortcuts to keep the newsroom running smoothly. Everything you need to upload
                        articles, maintain staff information, and review published content lives here.
                    </p>
                </header>

                <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                    {PRIMARY_ACTIONS.map(({title, description, href, icon: Icon, accent, cta}) => (
                        <div
                            key={title}
                            className="group flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
                        >
                            <div>
                                <span className={`inline-flex rounded-xl p-3 ${accent}`}>
                                    <Icon aria-hidden="true" className="h-6 w-6"/>
                                </span>
                                <h2 className="mt-5 text-2xl font-semibold text-slate-900">{title}</h2>
                                <p className="mt-3 text-sm text-slate-600">{description}</p>
                            </div>
                            <div className="mt-6">
                                <Link
                                    href={href}
                                    className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 transition group-hover:text-indigo-700"
                                >
                                    {cta}
                                    <ArrowRightIcon aria-hidden="true" className="h-4 w-4 transition group-hover:translate-x-1"/>
                                </Link>
                            </div>
                        </div>
                    ))}
                </section>

                <section className="mt-16 grid gap-6 lg:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                        <h2 className="text-xl font-semibold text-slate-900">Run Through Your Checklist</h2>
                        <p className="mt-3 text-sm text-slate-600">
                            Before publishing, double-check that each article has a featured image, headline, blurb, and
                            the correct authors attached. Keeping staff entries updated ensures everyone receives proper
                            credit.
                        </p>
                        <ul className="mt-4 space-y-3 text-sm text-slate-700">
                            <li className="flex items-start gap-2">
                                <span className="mt-1 inline-block h-2 w-2 rounded-full bg-emerald-500"/>
                                Assign at least one author from the staff directory.
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="mt-1 inline-block h-2 w-2 rounded-full bg-emerald-500"/>
                                Verify tags so stories surface on the correct category pages.
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="mt-1 inline-block h-2 w-2 rounded-full bg-emerald-500"/>
                                Preview the article card and the full page before publishing.
                            </li>
                        </ul>
                    </div>
                    <div className="rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/70 p-6">
                        <h2 className="text-xl font-semibold text-indigo-900">Need Something Else?</h2>
                        <p className="mt-3 text-sm text-indigo-700">
                            Reach out to the development team if you need a new admin tool, category, or automation. We
                            can help tailor the dashboard to match the newsroom&rsquo;s workflow.
                        </p>
                        <p className="mt-4 text-sm text-indigo-700">
                            For urgent publishing issues, drop a note in the #yellow-pages Slack channel or email{' '}
                            <a href="mailto:techsupport@example.com" className="font-medium underline">
                                techsupport@example.com
                            </a>.
                        </p>
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
