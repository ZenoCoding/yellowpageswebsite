#!/usr/bin/env node

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const shouldWrite = process.argv.includes('--write');
const serviceAccountSource = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!serviceAccountSource) {
    console.error('FIREBASE_SERVICE_ACCOUNT is required (a JSON string or path to a JSON file).');
    process.exit(1);
}

const loadServiceAccount = () => {
    if (serviceAccountSource.trim().startsWith('{')) {
        return JSON.parse(serviceAccountSource);
    }

    const resolvedPath = path.resolve(serviceAccountSource);
    return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
};

const serviceAccount = loadServiceAccount();
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || serviceAccount.project_id;
const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`;

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId,
    storageBucket,
});

const db = admin.firestore();
const bucket = admin.storage().bucket();
const FIRESTORE_MARKDOWN_LIMIT_BYTES = 750_000;

async function backfillArticleMarkdown() {
    const snapshot = await db.collection('articles').get();
    const candidates = snapshot.docs.filter((document) => {
        const data = document.data() || {};
        return typeof data.markdown !== 'string' && typeof data.path === 'string' && data.path.trim().length > 0;
    });

    console.log(`Found ${candidates.length} of ${snapshot.size} articles without a Firestore Markdown backup.`);

    if (!shouldWrite) {
        console.log('Dry run only. Re-run with --write after Firebase Storage access is restored.');
        return;
    }

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const document of candidates) {
        const data = document.data() || {};
        try {
            const [contents] = await bucket.file(data.path).download();
            if (contents.byteLength > FIRESTORE_MARKDOWN_LIMIT_BYTES) {
                console.warn(`Skipping ${document.id}: Markdown is ${contents.byteLength} bytes.`);
                skipped += 1;
                continue;
            }

            await document.ref.update({markdown: contents.toString('utf8')});
            updated += 1;
            console.log(`Backed up ${document.id}.`);
        } catch (error) {
            failed += 1;
            console.error(`Failed ${document.id}: ${error.code || error.message}`);
        }
    }

    console.log(`Finished: ${updated} updated, ${skipped} skipped, ${failed} failed.`);
    if (failed > 0) {
        process.exitCode = 1;
    }
}

backfillArticleMarkdown().catch((error) => {
    console.error('Backfill failed:', error);
    process.exit(1);
});
