import 'dotenv/config';
import {getFirebaseAdmin} from '../lib/server/firebaseAdmin.js';

const execute = process.argv.includes('--execute');
const OCTOBER_ISSUE = '2025-10-october-2025-26';
const NOVEMBER_ISSUE = '2025-11-november-2025-26';
const JANUARY_ISSUE = 'LO7MzlFEz1jvG4DzhT7U';
const duplicateArticles = [
    ['2025-10-01_FreeSchlep_What_Roblox_s_ban_Says_About_Child_Safety_and_Platform_Power', '2025-11-05_FreeSchlep_What_Roblox_s_ban_Says_About_Child_Safety_and_Platform_Power'],
    ['2025-10-01_do_test_scores_really_affect_your_future_careers', '2025-11-05_Do_Test_Scores_Really_Matter'],
    ['2025-10-01_halloween_at_bifu', '2025-11-05_What_s_BIFU_Wearing_This_Halloween'],
    ['2025-10-01_taylor_swift_s_album_release_a_glimpse_into_the_life_of_a_showgirl', '2025-11-05_Taylor_Swift_Album_Release_A_Glimpse_Into_The_Life_of_a_Showgirl'],
];
const draftRepairs = [
    ['2025-10-october-2025-26:1NlJgJga1e0X3yyMJnfKZYr0k5s77YgcX', {status: 'duplicate', duplicateOfArticleId: duplicateArticles[0][1], publishedArticleId: duplicateArticles[0][1]}],
    ['2025-10-october-2025-26:1OiZkVge6z4rHcErNmgjfyzf2Pl7yGbbr', {status: 'duplicate', duplicateOfArticleId: duplicateArticles[1][1], publishedArticleId: duplicateArticles[1][1]}],
    ['2025-10-october-2025-26:1dmlUueMpPGMoMN_6k6EybOJHp_h_ACC0', {status: 'duplicate', duplicateOfArticleId: duplicateArticles[2][1], publishedArticleId: duplicateArticles[2][1]}],
    ['2025-10-october-2025-26:1P4Kld3ROLAvjp6PKh1DTxxhrinhxTayQ', {status: 'duplicate', duplicateOfArticleId: duplicateArticles[3][1], publishedArticleId: duplicateArticles[3][1]}],
    ['2025-10-october-2025-26:1-D4YGo57FuFPtpFetR0hsrnfpIIxsRIy', {status: 'duplicate', duplicateOfArticleId: '2025-11-05_Do_Movie_Ratings_Still_Make_Sense', publishedArticleId: '2025-11-05_Do_Movie_Ratings_Still_Make_Sense'}],
    ['2025-10-october-2025-26:1Hp3JhvoYE4ZlfxOljoj1pUVIZNkVA2GN', {status: 'rejected', rejectionReason: 'The source contains notes but no finished article.'}],
    ['2025-10-october-2025-26:16D3SuNM19jwsXcbYWyDg4xGDFmyZ0dRM', {issueId: NOVEMBER_ISSUE, date: '2025-11-05', publicationDate: '2025-11-05'}],
];

const main = async () => {
    const admin = getFirebaseAdmin(); const db = admin.firestore();
    const targets = [
        ...duplicateArticles.map(([id]) => db.collection('articles').doc(id)),
        ...draftRepairs.map(([id]) => db.collection('articleDrafts').doc(id)),
        db.collection('articles').doc('2025-10-01_israel_faces_global_isolation_amidst_the_persisting_humanitarian_crisis'),
        db.collection('articleDrafts').doc('2025-10-october-2025-26:1MPDt6zoQkOQm_hDxzDn1XXT92TIBImOI'),
        db.collection('articles').doc('2025-11-05_BASIS_International_Students_Arrive_on_Campus'),
        db.collection('articles').doc('2025-11-05_Do_Test_Scores_Really_Matter'),
        db.collection('issues').doc(JANUARY_ISSUE),
    ];
    const snapshots = await Promise.all(targets.map((ref) => ref.get()));
    const missing = snapshots.filter((snapshot) => !snapshot.exists).map((snapshot) => snapshot.ref.path);
    if (missing.length) throw new Error(`Repair targets are missing: ${missing.join(', ')}`);
    console.log(JSON.stringify({mode: execute ? 'execute' : 'dry-run', deleteDuplicateArticles: duplicateArticles, draftRepairs, moveIsraelTo: NOVEMBER_ISSUE, fixJanuarySlug: '2026-01-january-2025-26'}, null, 2));
    if (!execute) return;

    const backupId = `volume5-repair-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const backupRef = db.collection('maintenanceBackups').doc(backupId);
    await backupRef.set({kind: 'volume5_issue_alignment', createdAt: admin.firestore.FieldValue.serverTimestamp(), createdBy: 'service-volume5-repair'});
    for (const snapshot of snapshots) {
        await backupRef.collection('documents').doc(snapshot.ref.path.replaceAll('/', '__')).set({path: snapshot.ref.path, data: snapshot.data()});
    }

    for (const [articleId, canonicalId] of duplicateArticles) {
        const articleRef = db.collection('articles').doc(articleId);
        const article = (await articleRef.get()).data();
        await articleRef.delete();
        if (article?.path) await admin.storage().bucket().file(article.path).delete({ignoreNotFound: true});
        console.log(`Removed duplicate ${articleId}; kept ${canonicalId}`);
    }
    for (const [draftId, repair] of draftRepairs) {
        await db.collection('articleDrafts').doc(draftId).update({...repair, updatedAt: admin.firestore.FieldValue.serverTimestamp()});
    }
    await db.collection('articles').doc('2025-10-01_israel_faces_global_isolation_amidst_the_persisting_humanitarian_crisis').update({
        issueId: NOVEMBER_ISSUE,
        date: '2025-11-05',
    });
    await db.collection('articleDrafts').doc('2025-10-october-2025-26:1MPDt6zoQkOQm_hDxzDn1XXT92TIBImOI').update({
        issueId: NOVEMBER_ISSUE,
        date: '2025-11-05',
        publicationDate: '2025-11-05',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await db.collection('articles').doc('2025-11-05_BASIS_International_Students_Arrive_on_Campus').update({title: 'BASIS International Students Arrive on Campus'});
    const authors = await db.collection('authors').get();
    const brandon = authors.docs.find((snapshot) => String(snapshot.data()?.fullName || '').trim().toLowerCase() === 'brandon yu');
    if (!brandon) throw new Error('Brandon Yu is missing from the staff directory.');
    await db.collection('articles').doc('2025-11-05_Do_Test_Scores_Really_Matter').update({authorIds: [brandon.id], author: ['Brandon Yu']});
    await brandon.ref.set({linkedArticleIds: admin.firestore.FieldValue.arrayUnion('2025-11-05_Do_Test_Scores_Really_Matter'), updatedAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: true});
    await db.collection('issues').doc(JANUARY_ISSUE).update({slug: '2026-01-january-2025-26', updatedAt: admin.firestore.FieldValue.serverTimestamp()});
    await backupRef.update({completedAt: admin.firestore.FieldValue.serverTimestamp()});
    console.log(JSON.stringify({backupId, repaired: true}, null, 2));
};

main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
