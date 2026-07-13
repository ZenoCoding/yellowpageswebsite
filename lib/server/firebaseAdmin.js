import fs from 'fs';
import path from 'path';
import * as admin from 'firebase-admin';

const loadServiceAccount = () => {
    const source = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!source) throw new Error('FIREBASE_SERVICE_ACCOUNT is not configured.');
    let normalizedSource = source.trim();
    const jsonStart = normalizedSource.indexOf('{');
    const jsonEnd = normalizedSource.lastIndexOf('}');
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
        return JSON.parse(normalizedSource.slice(jsonStart, jsonEnd + 1));
    }
    if (jsonStart >= 0) {
        throw new Error(
            'FIREBASE_SERVICE_ACCOUNT is truncated. Restart the Next.js development server after editing .env.'
        );
    }
    const firstCharacter = normalizedSource[0];
    const lastCharacter = normalizedSource[normalizedSource.length - 1];
    if (
        normalizedSource.length >= 2 &&
        ((firstCharacter === "'" && lastCharacter === "'") ||
            (firstCharacter === '"' && lastCharacter === '"'))
    ) {
        normalizedSource = normalizedSource.slice(1, -1).trim();
    }
    return JSON.parse(fs.readFileSync(path.resolve(normalizedSource), 'utf8'));
};

export const getFirebaseAdmin = () => {
    if (!admin.apps.length) {
        const serviceAccount = loadServiceAccount();
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || serviceAccount.project_id,
            storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
        });
    }
    return admin;
};

export const requireAdminUser = async (request) => {
    const authorization = request.headers.authorization || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) {
        const error = new Error('Authentication is required.');
        error.status = 401;
        throw error;
    }

    const firebaseAdmin = getFirebaseAdmin();
    const decodedToken = await firebaseAdmin.auth().verifyIdToken(match[1]);
    const adminSnapshot = await firebaseAdmin.firestore().doc('admin/ids').get();
    const adminIds = adminSnapshot.data()?.ids;
    if (!Array.isArray(adminIds) || !adminIds.includes(decodedToken.uid)) {
        const error = new Error('Administrator permission is required.');
        error.status = 403;
        throw error;
    }
    return decodedToken;
};
