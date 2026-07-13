import {requireAdminUser} from '../../../lib/server/firebaseAdmin';
import {backfillIssueImages, publishReadyIssue, recheckIssueDrafts} from '../../../lib/server/publishIssue';

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return response.status(405).json({error: 'Method not allowed.'});
    }
    try {
        const user = await requireAdminUser(request);
        const issueId = typeof request.body?.issueId === 'string' ? request.body.issueId.trim() : '';
        if (!issueId) return response.status(400).json({error: 'issueId is required.'});
        const result = request.body?.action === 'recheck' ? await recheckIssueDrafts({issueId, userId: user.uid})
            : request.body?.action === 'backfill_images' ? await backfillIssueImages({issueId, driveAccessToken: request.body?.driveAccessToken || '', userId: user.uid})
            : await publishReadyIssue({
            issueId,
            driveAccessToken: typeof request.body?.driveAccessToken === 'string' ? request.body.driveAccessToken : '',
            userId: user.uid,
        });
        return response.status(200).json(result);
    } catch (error) {
        console.error('Issue publication failed:', error?.message || error);
        return response.status(error?.status || 500).json({
            error: error?.status ? error.message : 'Issue publication failed unexpectedly.',
            details: error?.details || null,
        });
    }
}
