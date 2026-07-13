#!/usr/bin/env node

/**
 * Backfill historical issue records and link published articles to them.
 *
 * Dry-run is the default and performs no writes:
 *   npm run backfill:issues
 *
 * Apply only after reviewing the dry-run report:
 *   npm run backfill:issues -- --apply
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const APPLY = process.argv.includes('--apply');
const UNKNOWN_ARGUMENTS = process.argv.slice(2).filter((argument) => argument !== '--apply');
if (UNKNOWN_ARGUMENTS.length > 0) {
    console.error(`Unknown argument(s): ${UNKNOWN_ARGUMENTS.join(', ')}`);
    process.exit(1);
}

const serviceAccountSource = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountSource) {
    console.error('FIREBASE_SERVICE_ACCOUNT is required (a JSON string or path to a JSON file).');
    process.exit(1);
}

function loadServiceAccount() {
    let source = serviceAccountSource.trim();
    const jsonStart = source.indexOf('{');
    const jsonEnd = source.lastIndexOf('}');
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
        return JSON.parse(source.slice(jsonStart, jsonEnd + 1));
    }
    if ((source.startsWith("'") && source.endsWith("'")) || (source.startsWith('"') && source.endsWith('"'))) {
        source = source.slice(1, -1).trim();
    }
    return JSON.parse(fs.readFileSync(path.resolve(source), 'utf8'));
}

const serviceAccount = loadServiceAccount();
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || serviceAccount.project_id,
});

const db = admin.firestore();

// This deliberately excludes February 2022. The site was incomplete for that
// school year, so no 2021-22 issue should be inferred or created.
const ISSUE_PLAN = [
    {year: 2022, month: 9, schoolYear: '2022-23', volumeNumber: 2, issueNumber: 1},
    {year: 2022, month: 10, schoolYear: '2022-23', volumeNumber: 2, issueNumber: 2},
    {year: 2022, month: 11, schoolYear: '2022-23', volumeNumber: 2, issueNumber: 3},
    {year: 2022, month: 12, schoolYear: '2022-23', volumeNumber: 2, issueNumber: 4},
    {year: 2023, month: 2, schoolYear: '2022-23', volumeNumber: 2, issueNumber: 5},
    {year: 2023, month: 9, schoolYear: '2023-24', volumeNumber: 3, issueNumber: 1},
    {year: 2023, month: 10, schoolYear: '2023-24', volumeNumber: 3, issueNumber: 2},
    {year: 2023, month: 11, schoolYear: '2023-24', volumeNumber: 3, issueNumber: 3},
    {year: 2025, month: 10, schoolYear: '2025-26', volumeNumber: 5, issueNumber: 1},
    {year: 2025, month: 11, schoolYear: '2025-26', volumeNumber: 5, issueNumber: 2},
    {year: 2025, month: 12, schoolYear: '2025-26', volumeNumber: 5, issueNumber: 3},
];

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

function pad(number) {
    return String(number).padStart(2, '0');
}

function issueIdFor(plan) {
    return `${plan.year}-${pad(plan.month)}-${MONTH_NAMES[plan.month - 1].toLowerCase()}-${plan.schoolYear}`;
}

function monthKey(year, month) {
    return `${year}-${pad(month)}`;
}

function normalizeArticleDate(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate().toISOString().slice(0, 10);
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    if (typeof value === 'string') {
        const exact = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (exact) return `${exact[1]}-${exact[2]}-${exact[3]}`;
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    }
    return null;
}

function chooseIssueDate(dateCounts) {
    return [...dateCounts.entries()]
        .sort(([dateA, countA], [dateB, countB]) => countB - countA || dateA.localeCompare(dateB))[0]?.[0] || null;
}

function sameIssueIdentity(issue, expected) {
    return issue && (
        issue.slug === expected.slug ||
        (issue.schoolYear === expected.schoolYear &&
            Number(issue.volumeNumber) === expected.volumeNumber &&
            Number(issue.issueNumber) === expected.issueNumber)
    );
}

async function main() {
    const [articleSnapshot, issueSnapshot] = await Promise.all([
        db.collection('articles').get(),
        db.collection('issues').get(),
    ]);
    const articles = articleSnapshot.docs.map((document) => ({
        id: document.id,
        ref: document.ref,
        data: document.data() || {},
        date: normalizeArticleDate(document.data()?.publicationDate ?? document.data()?.date),
    }));
    const issuesById = new Map(issueSnapshot.docs.map((document) => [document.id, document.data() || {}]));
    const issuesBySlug = new Map();
    issueSnapshot.docs.forEach((document) => {
        const slug = document.data()?.slug;
        if (slug) issuesBySlug.set(slug, {id: document.id, data: document.data() || {}});
    });

    const skippedFebruary2022 = articles.filter((article) => article.date?.startsWith('2022-02-'));
    const invalidDates = articles.filter((article) => !article.date);
    const plannedMonthKeys = new Set(ISSUE_PLAN.map((plan) => monthKey(plan.year, plan.month)));
    const unexpectedDatedArticles = articles.filter((article) => (
        article.date &&
        !article.date.startsWith('2022-02-') &&
        !plannedMonthKeys.has(article.date.slice(0, 7))
    ));
    const proposals = [];
    const conflicts = [];

    for (const plan of ISSUE_PLAN) {
        const key = monthKey(plan.year, plan.month);
        const matchingArticles = articles.filter((article) => article.date?.startsWith(`${key}-`));
        const dateCounts = new Map();
        matchingArticles.forEach((article) => dateCounts.set(article.date, (dateCounts.get(article.date) || 0) + 1));
        const targetPublicationDate = chooseIssueDate(dateCounts);
        const id = issueIdFor(plan);
        const name = `${MONTH_NAMES[plan.month - 1]} ${plan.year}`;
        const slug = id;
        const expected = {
            name,
            slug,
            schoolYear: plan.schoolYear,
            volumeNumber: plan.volumeNumber,
            issueNumber: plan.issueNumber,
            targetPublicationDate,
            status: 'published',
            publishedAt: targetPublicationDate
                ? admin.firestore.Timestamp.fromDate(new Date(`${targetPublicationDate}T12:00:00.000Z`))
                : null,
        };

        const sameSlugElsewhere = issuesBySlug.get(slug);
        if (sameSlugElsewhere && sameSlugElsewhere.id !== id) {
            conflicts.push({type: 'issue_slug', id, detail: `Slug already belongs to issue ${sameSlugElsewhere.id}.`});
        }
        const existingTarget = issuesById.get(id);
        if (existingTarget && !sameIssueIdentity(existingTarget, expected)) {
            conflicts.push({type: 'issue_identity', id, detail: 'Deterministic issue ID exists with different numbering or school year.'});
        }

        const assignments = [];
        for (const article of matchingArticles) {
            const existingIssueId = typeof article.data.issueId === 'string' ? article.data.issueId.trim() : '';
            if (existingIssueId && existingIssueId !== id) {
                const existingIssue = issuesById.get(existingIssueId);
                if (!sameIssueIdentity(existingIssue, expected)) {
                    conflicts.push({
                        type: 'article_assignment',
                        id: article.id,
                        detail: `Already assigned to ${existingIssueId}; expected ${id}.`,
                    });
                    continue;
                }
            }
            assignments.push(article);
        }
        proposals.push({id, expected, matchingArticles, assignments, dateCounts});
    }

    console.log(`Historical issue backfill: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
    console.log(`Live source: ${articleSnapshot.size} articles, ${issueSnapshot.size} existing issues.`);
    console.log('Issue date rule: use the most common stored article date in that month; choose the earliest date when tied.');
    console.log('');
    proposals.forEach((proposal) => {
        const distribution = [...proposal.dateCounts.entries()]
            .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
            .map(([date, count]) => `${date} (${count})`)
            .join(', ') || 'none';
        console.log(`${proposal.id}`);
        console.log(`  ${proposal.expected.name} | ${proposal.expected.schoolYear} | Vol. ${proposal.expected.volumeNumber}, No. ${proposal.expected.issueNumber}`);
        console.log(`  Articles: ${proposal.matchingArticles.length}; eligible assignments: ${proposal.assignments.length}`);
        console.log(`  Date distribution: ${distribution}`);
        console.log(`  Issue publication date: ${proposal.expected.targetPublicationDate || 'MISSING'}`);
    });

    console.log('');
    console.log(`Skipped February 2022 articles: ${skippedFebruary2022.length}`);
    skippedFebruary2022.forEach((article) => console.log(`  ${article.id} | ${article.date} | ${article.data.title || '(untitled)'}`));
    console.log(`Articles with unreadable/missing dates (left untouched): ${invalidDates.length}`);
    invalidDates.forEach((article) => console.log(`  ${article.id} | ${article.data.title || '(untitled)'}`));
    console.log(`Dated articles outside the confirmed issue plan (left untouched): ${unexpectedDatedArticles.length}`);
    unexpectedDatedArticles.forEach((article) => console.log(`  ${article.id} | ${article.date} | ${article.data.title || '(untitled)'}`));
    console.log(`Conflicts: ${conflicts.length}`);
    conflicts.forEach((conflict) => console.log(`  [${conflict.type}] ${conflict.id}: ${conflict.detail}`));

    if (!APPLY) {
        console.log('');
        console.log('Dry run complete. No writes performed. Re-run with --apply only after reviewing this report.');
        return;
    }
    if (conflicts.some((conflict) => conflict.type.startsWith('issue_'))) {
        throw new Error('Issue identity/slug conflicts must be resolved before applying. No writes performed.');
    }
    if (proposals.some((proposal) => !proposal.expected.targetPublicationDate || proposal.matchingArticles.length === 0)) {
        throw new Error('At least one planned issue has no dated articles. No writes performed.');
    }
    if (unexpectedDatedArticles.length > 0) {
        throw new Error('Dated articles exist outside the confirmed issue plan. No writes performed.');
    }

    const batch = db.batch();
    proposals.forEach((proposal) => {
        batch.set(db.collection('issues').doc(proposal.id), {
            ...proposal.expected,
            ...(issuesById.has(proposal.id) ? {} : {createdAt: admin.firestore.FieldValue.serverTimestamp()}),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            historicalBackfillVersion: 1,
        }, {merge: true});
        proposal.assignments.forEach((article) => {
            batch.update(article.ref, {issueId: proposal.id});
        });
    });
    await batch.commit();
    const assignmentCount = proposals.reduce((total, proposal) => total + proposal.assignments.length, 0);
    console.log(`Applied ${proposals.length} issue upserts and ${assignmentCount} article assignments.`);
}

main().catch((error) => {
    console.error('Historical issue backfill failed:', error.message || error);
    process.exit(1);
});
