#!/usr/bin/env node
/**
 * One-off migration to replace "creative" tags/categories with "feature".
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT=/absolute/path/to/serviceAccountKey.json \
 *   FIREBASE_PROJECT_ID=your-project-id \
 *   node scripts/migrateCreativeToFeature.js
 *
 * The script requires a service account key with Firestore write access.
 * FIREBASE_SERVICE_ACCOUNT can be either an absolute path to the JSON file
 * or the raw JSON string itself. The script loads environment variables via
 * dotenv so you can also create a .env file.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const SERVICE_ACCOUNT_ENV = process.env.FIREBASE_SERVICE_ACCOUNT;
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;

if (!SERVICE_ACCOUNT_ENV) {
    console.error('FIREBASE_SERVICE_ACCOUNT env var is required (path or JSON for service account).');
    process.exit(1);
}

let serviceAccount;

const looksLikeJson = SERVICE_ACCOUNT_ENV.trim().startsWith('{');

if (looksLikeJson) {
    try {
        serviceAccount = JSON.parse(SERVICE_ACCOUNT_ENV);
    } catch (error) {
        console.error('Unable to parse service account JSON from FIREBASE_SERVICE_ACCOUNT:', error.message);
        process.exit(1);
    }
} else {
    const resolvedServiceAccountPath = path.resolve(SERVICE_ACCOUNT_ENV);

    if (!fs.existsSync(resolvedServiceAccountPath)) {
        console.error(`Service account file not found at ${resolvedServiceAccountPath}`);
        process.exit(1);
    }

    try {
        serviceAccount = JSON.parse(fs.readFileSync(resolvedServiceAccountPath, 'utf8'));
    } catch (error) {
        console.error('Unable to parse service account JSON file:', error.message);
        process.exit(1);
    }
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: PROJECT_ID || serviceAccount.project_id,
});

const db = admin.firestore();

const TARGET_TAG = 'feature';
const LEGACY_TAG = 'creative';
const COLLECTION = 'articles';
const BATCH_LIMIT = 400; // stay safely under Firestore batch limit of 500

const normalizeTag = (tag) => {
    if (!tag) return null;
    const lower = tag.toString().toLowerCase();
    if (lower === LEGACY_TAG) {
        return TARGET_TAG;
    }
    return lower;
};

const transformTags = (tags) => {
    if (Array.isArray(tags)) {
        const updated = tags
            .map((tag) => normalizeTag(tag))
            .filter((tag) => Boolean(tag));
        const deduped = Array.from(new Set(updated));
        return {
            changed: deduped.join('|') !== tags.join('|'),
            value: deduped,
        };
    }

    if (typeof tags === 'string') {
        const normalized = normalizeTag(tags);
        const changed = normalized !== tags.toLowerCase();
        return {
            changed,
            value: normalized ? [normalized] : [],
        };
    }

    return { changed: false, value: tags };
};

const transformCategory = (category) => {
    if (typeof category !== 'string') {
        return { changed: false, value: category };
    }
    const lower = category.toLowerCase();
    if (lower === LEGACY_TAG) {
        return { changed: true, value: TARGET_TAG };
    }
    return { changed: false, value: category };
};

async function migrateCreativeToFeature() {
    console.log(`Starting migration on collection "${COLLECTION}"...`);

    const snapshot = await db.collection(COLLECTION).get();
    if (snapshot.empty) {
        console.log('No documents found. Migration complete.');
        return;
    }

    console.log(`Fetched ${snapshot.size} documents. Processing...`);

    const updates = [];

    snapshot.forEach((doc) => {
        const data = doc.data();

        const { changed: tagsChanged, value: newTags } = transformTags(data.tags);
        const { changed: categoryChanged, value: newCategory } = transformCategory(data.category);

        if (tagsChanged || categoryChanged) {
            const payload = {};
            if (tagsChanged) {
                payload.tags = newTags;
            }
            if (categoryChanged) {
                payload.category = newCategory;
            }
            updates.push({ ref: doc.ref, data: payload });
        }
    });

    if (updates.length === 0) {
        console.log('No documents required updates. Migration complete.');
        return;
    }

    console.log(`Preparing to update ${updates.length} documents...`);

    let processed = 0;
    while (updates.length > 0) {
        const batch = db.batch();
        const chunk = updates.splice(0, BATCH_LIMIT);
        chunk.forEach(({ ref, data }) => {
            batch.update(ref, data);
        });
        await batch.commit();
        processed += chunk.length;
        console.log(`Committed batch. Total updated so far: ${processed}`);
    }

    console.log('Migration complete!');
}

migrateCreativeToFeature()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('Migration failed:', error);
        process.exit(1);
    });
