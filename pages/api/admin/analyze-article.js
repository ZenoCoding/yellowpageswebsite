import {analyzeArticleSubmission} from '../../../lib/server/articleAnalysis';
import {requireAdminUser} from '../../../lib/server/firebaseAdmin';

export const config = {
    api: {bodyParser: {sizeLimit: '8mb'}},
};

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return response.status(405).json({error: 'Method not allowed.'});
    }

    try {
        const user = await requireAdminUser(request);
        const result = await analyzeArticleSubmission({
            submission: request.body?.submission,
            userId: user.uid,
        });
        return response.status(200).json(result);
    } catch (error) {
        console.error('Article analysis failed:', error?.message || error);
        return response.status(error?.status || 500).json({
            error: error?.status ? error.message : 'Article analysis failed unexpectedly.',
        });
    }
}
