import crypto from 'crypto';
import {getFirebaseAdmin} from './firebaseAdmin';
import {findWebImageSources} from './imageSourceLookup';

export const ARTICLE_ANALYSIS_MODEL = 'gpt-5.6-luna';

const ALLOWED_TAGS = ['news', 'feature', 'opinion', 'sports', 'ae', 'hob', 'creative', 'student life', 'events'];
const MAX_TAB_CHARACTERS = 20000;
const MAX_TOTAL_CHARACTERS = 90000;

const analysisSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'readiness',
        'confidence',
        'selectedDocumentId',
        'selectedTabId',
        'selectionReason',
        'title',
        'authors',
        'suggestedTags',
        'blurb',
        'articleMarkdown',
        'editorialNotes',
        'warnings',
        'removedMaterial',
        'imageRecommendations',
    ],
    properties: {
        readiness: {type: 'string', enum: ['ready', 'needs_review', 'not_ready']},
        confidence: {type: 'number', minimum: 0, maximum: 1},
        selectedDocumentId: {type: ['string', 'null']},
        selectedTabId: {type: ['string', 'null']},
        selectionReason: {type: 'string'},
        title: {type: 'string'},
        authors: {type: 'array', items: {type: 'string'}},
        suggestedTags: {type: 'array', items: {type: 'string', enum: ALLOWED_TAGS}},
        blurb: {type: 'string'},
        articleMarkdown: {type: 'string'},
        editorialNotes: {type: 'array', items: {type: 'string'}},
        warnings: {type: 'array', items: {type: 'string'}},
        removedMaterial: {type: 'array', items: {type: 'string'}},
        imageRecommendations: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['sourceId', 'source', 'visuallyAnalyzed', 'role', 'insertAfterParagraph', 'placement', 'caption', 'altText', 'warning'],
                properties: {
                    sourceId: {type: 'string'},
                    source: {type: 'string'},
                    visuallyAnalyzed: {type: 'boolean'},
                    role: {type: 'string', enum: ['featured', 'inline', 'unused']},
                    insertAfterParagraph: {type: ['integer', 'null'], minimum: 1},
                    placement: {type: 'string'},
                    caption: {type: 'string'},
                    altText: {type: 'string'},
                    warning: {type: 'string'},
                },
            },
        },
    },
};

const prepareSource = (submission) => {
    let remaining = MAX_TOTAL_CHARACTERS;
    const documents = [];
    for (const document of submission?.documents || []) {
        const tabs = [];
        for (const tab of document.tabs || []) {
            if (remaining <= 0) break;
            const originalText = typeof tab.text === 'string' ? tab.text : '';
            const text = originalText.slice(0, Math.min(MAX_TAB_CHARACTERS, remaining));
            remaining -= text.length;
            tabs.push({
                id: tab.id || null,
                title: tab.title || 'Untitled tab',
                characterCount: originalText.length,
                truncated: text.length < originalText.length,
                inlineImages: (tab.inlineImages || []).map((image) => ({
                    id: image.id,
                    altTextTitle: image.altTextTitle || '',
                    altTextDescription: image.altTextDescription || '',
                })),
                text,
            });
        }
        documents.push({id: document.id, name: document.name, tabs});
    }

    return {
        sourceName: submission?.root?.name || '',
        documents,
        pdfFiles: (submission?.pdfFiles || []).map((file) => ({
            id: file.id,
            name: file.name || 'Article.pdf',
            modifiedTime: file.modifiedTime || null,
        })),
        separateImages: (submission?.images || []).map((image) => ({
            id: image.id,
            name: image.name,
            mimeType: image.mimeType,
        })),
        sourceWarnings: submission?.warnings || [],
        inputTruncated: remaining <= 0,
    };
};

const extractOutputText = (response) => {
    for (const item of response.output || []) {
        if (item.type !== 'message') continue;
        for (const content of item.content || []) {
            if (content.type === 'refusal') throw new Error(content.refusal || 'The model declined this submission.');
            if (content.type === 'output_text' && content.text) return content.text;
        }
    }
    throw new Error('The model returned no editorial analysis.');
};

export const analyzeArticleSubmission = async ({submission, userId}) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        const error = new Error('OPENAI_API_KEY is not configured on the server.');
        error.status = 503;
        throw error;
    }

    const preparedSource = prepareSource(submission);
    const visionImages = Array.isArray(submission?.visionImages)
        ? submission.visionImages.filter((image) => typeof image?.dataUrl === 'string').slice(0, 6)
        : [];
    const pdfFiles = Array.isArray(submission?.pdfFiles)
        ? submission.pdfFiles.filter((file) => typeof file?.dataUrl === 'string').slice(0, 4)
        : [];
    if (preparedSource.documents.length === 0 && pdfFiles.length === 0) {
        const error = new Error('This submission has no readable Google Docs or PDFs to analyze.');
        error.status = 400;
        throw error;
    }

    const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: ARTICLE_ANALYSIS_MODEL,
            store: false,
            safety_identifier: crypto.createHash('sha256').update(String(userId)).digest('hex'),
            reasoning: {effort: 'low'},
            instructions: `You are an editorial preparation assistant for a high-school student newspaper.

Choose the single Google Doc tab or PDF most likely to contain the publishable article. Distinguish finished prose from pitches, outlines, interviews, transcripts, captions, research notes, and competing drafts. An empty tab named Final Draft is not evidence of readiness. If multiple plausible drafts exist, choose the best candidate but set readiness to needs_review and explain the ambiguity. For a selected PDF, use its file ID as selectedDocumentId and null as selectedTabId.

Prepare a conservative publication draft. Preserve the student's wording, point of view, quotations, and substantive claims. Fix only obvious formatting artifacts and spacing. The articleMarkdown field must contain body copy only: never include the publication title or a byline because those are rendered from separate fields. Do not invent facts, quotes, names, captions, image credits, blurbs, or visual details. Do not perform unrequested substantive rewriting. Retain meaningful Markdown emphasis, subheadings, lists, and links when supported by the source.

For blurb, copy a short contiguous excerpt verbatim from the article; do not summarize or paraphrase it. Suggest one or more allowed tags. Images listed in visionImageMap are followed by image inputs in the same order and may be visually described. Set visuallyAnalyzed true only for those exact images. Generate concise accessibility alt text from visible content, but do not infer sensitive traits, identities, relationships, location, ownership, licensing, or events that are not visually established. A caption must be copied from explicit source text or left empty—never create one from the image. Treat filenames and existing alt text as metadata, not proof. Leave unsupported caption or alt-text fields empty and warn the editor.

Classify every supplied image as featured, inline, or unused. When at least one visually analyzed image is relevant and usable, choose exactly one featured image. Assign other distinct, relevant images to inline and mark irrelevant, duplicate, or unusable images unused. For each inline image, set insertAfterParagraph to the 1-based number of the Markdown paragraph after which it should appear; count non-empty blocks separated by blank lines. Use null for featured and unused images. Place inline images at natural topic transitions, distribute them through the article, and never change the article prose to accommodate an image. The placement field should briefly explain the choice.

Readiness measures production completeness, not whether every claim has been independently fact-checked. A complete student article should be ready even when its claims, quotations, tone, or timeliness would benefit from optional editorial verification. Use needs_review only for a concrete structural problem such as competing drafts, unfinished prose or quotations, unresolved placeholders, a byline conflict, or ambiguity about what text belongs to the article. Return not_ready for pitches, outlines, empty drafts, interview notes without a finished article, or sources without complete publishable prose. Record optional fact-check suggestions in warnings without lowering readiness.`,
            input: [{
                role: 'user',
                content: [
                    {type: 'input_text', text: JSON.stringify({
                        ...preparedSource,
                        visionImageMap: visionImages.map(({sourceId, sourceName, sourceKind}) => ({
                            sourceId,
                            sourceName,
                            sourceKind,
                        })),
                    })},
                    ...pdfFiles.map((file) => ({
                        type: 'input_file',
                        filename: file.name || 'Article.pdf',
                        file_data: file.dataUrl,
                    })),
                    ...visionImages.map((image) => ({
                        type: 'input_image',
                        image_url: image.dataUrl,
                        detail: 'low',
                    })),
                ],
            }],
            text: {
                verbosity: 'medium',
                format: {
                    type: 'json_schema',
                    name: 'article_editorial_analysis',
                    strict: true,
                    schema: analysisSchema,
                },
            },
            max_output_tokens: 16000,
        }),
    });

    const payload = await response.json();
    if (!response.ok) {
        const error = new Error(payload?.error?.message || `OpenAI request failed (${response.status}).`);
        error.status = response.status === 401 ? 503 : 502;
        throw error;
    }

    let imageSources = [];
    try {
        const firebaseAdmin = getFirebaseAdmin();
        const token = await firebaseAdmin.app().options.credential.getAccessToken();
        imageSources = await findWebImageSources({images: visionImages, accessToken: token?.access_token});
    } catch (error) {
        console.warn('Image source lookup skipped:', error?.message || error);
        imageSources = visionImages.map((image) => ({sourceId: image.sourceId, source: null, status: 'unavailable'}));
    }

    return {
        model: ARTICLE_ANALYSIS_MODEL,
        responseId: payload.id,
        usage: payload.usage || null,
        analysis: JSON.parse(extractOutputText(payload)),
        sourceMeta: {inputTruncated: preparedSource.inputTruncated},
        imageSources,
    };
};
