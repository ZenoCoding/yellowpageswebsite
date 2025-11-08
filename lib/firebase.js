import { initFirebase } from "../firebase/initFirebase.js"
import { getApp } from "firebase/app"
import { doc, getFirestore, collection, getDocs, getDoc, query, where, limit } from "firebase/firestore"
import { getDownloadURL, getStorage, getStream, ref, getBytes } from "firebase/storage";
import matter from 'gray-matter';
import { remark } from 'remark';
import html from 'remark-html';
import { normalizeLegacyImageMarkdown, replaceImageTokensWithFigures } from './articleImages';


const app = getApp()
const db = getFirestore(app)
const storage = getStorage(app)

const mapImageSnapshot = (snapshot) => {
	const data = snapshot.data() || {};
	return {
		id: snapshot.id,
		url: typeof data.url === 'string' ? data.url : null,
		storagePath: typeof data.storagePath === 'string' ? data.storagePath : null,
		fileName: typeof data.fileName === 'string' ? data.fileName : null,
		caption: typeof data.caption === 'string' ? data.caption : '',
		credit: typeof data.credit === 'string' ? data.credit : '',
		altText: typeof data.altText === 'string' ? data.altText : '',
		linkedArticleIds: Array.isArray(data.linkedArticleIds)
			? data.linkedArticleIds.filter((value) => typeof value === 'string')
			: [],
		uploadedBy: typeof data.uploadedBy === 'string' ? data.uploadedBy : null,
		uploadedByName: typeof data.uploadedByName === 'string' ? data.uploadedByName : null,
		createdAt: convertTimestamp(data.createdAt),
		lastUsedAt: convertTimestamp(data.lastUsedAt),
	};
};

const imageCacheById = new Map();
const imageCacheByUrl = new Map();

const getImageRecordById = async (imageId) => {
	if (!imageId || typeof imageId !== 'string') {
		return null;
	}
	if (imageCacheById.has(imageId)) {
		return imageCacheById.get(imageId);
	}
	try {
		const snapshot = await getDoc(doc(db, 'images', imageId));
		if (!snapshot.exists()) {
			imageCacheById.set(imageId, null);
			return null;
		}
		const record = mapImageSnapshot(snapshot);
		imageCacheById.set(imageId, record);
		if (typeof record?.url === 'string') {
			imageCacheByUrl.set(record.url, record);
		}
		return record;
	} catch (error) {
		return null;
	}
};

const getImageRecordByUrl = async (url) => {
	if (!url || typeof url !== 'string') {
		return null;
	}
	if (imageCacheByUrl.has(url)) {
		return imageCacheByUrl.get(url);
	}
	try {
		const imagesRef = collection(db, 'images');
		const imageQuery = query(imagesRef, where('url', '==', url), limit(1));
		const snapshot = await getDocs(imageQuery);
		if (snapshot.empty) {
			imageCacheByUrl.set(url, null);
			return null;
		}
		const record = mapImageSnapshot(snapshot.docs[0]);
		imageCacheById.set(record.id, record);
		imageCacheByUrl.set(url, record);
		return record;
	} catch (error) {
		return null;
	}
};

const findLinkedImageForArticle = async (articleId) => {
	if (!articleId || typeof articleId !== 'string') {
		return null;
	}
	try {
		const imagesRef = collection(db, 'images');
		const imageQuery = query(imagesRef, where('linkedArticleIds', 'array-contains', articleId), limit(1));
		const snapshot = await getDocs(imageQuery);
		if (snapshot.empty) {
			return null;
		}
		const record = mapImageSnapshot(snapshot.docs[0]);
		imageCacheById.set(record.id, record);
		if (typeof record?.url === 'string') {
			imageCacheByUrl.set(record.url, record);
		}
		return record;
	} catch (error) {
		return null;
	}
};

const resolveFeaturedImageForArticle = async (articleId, { featuredImageId, legacyImageUrl }) => {
	const byId = await getImageRecordById(featuredImageId);
	if (byId) {
		return byId;
	}
	const linked = await findLinkedImageForArticle(articleId);
	if (linked) {
		return linked;
	}
	return getImageRecordByUrl(legacyImageUrl);
};

const toSerializableImage = (record) => {
	if (!record) {
		return null;
	}
	return {
		id: record.id,
		url: record.url,
		caption: record.caption,
		credit: record.credit,
		altText: record.altText,
		storagePath: record.storagePath,
	};
};

const normalizeAuthorTokens = (value) => {
	if (Array.isArray(value)) {
		return value
			.map((token) => (typeof token === 'string' ? token.trim() : ''))
			.filter((token) => token.length > 0);
	}
	if (typeof value === 'string') {
		return value
			.split(',')
			.map((token) => token.trim())
			.filter((token) => token.length > 0);
	}
	return [];
};

const convertTimestamp = (value) => {
	if (!value) {
		return undefined;
	}
	if (value instanceof Date) {
		return value;
	}
	if (typeof value?.toDate === 'function') {
		try {
			return value.toDate();
		} catch (error) {
			return undefined;
		}
	}
	return undefined;
};

const toIsoStringSafe = (value) => {
	const dateValue = convertTimestamp(value);
	if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) {
		return dateValue.toISOString();
	}
	if (typeof value === 'string') {
		return value;
	}
	if (value && typeof value.seconds === 'number') {
		try {
			return new Date(value.seconds * 1000).toISOString();
		} catch (error) {
			return null;
		}
	}
	return null;
};

const mapAuthorSnapshot = (snapshot) => {
	const data = snapshot.data() || {};
	return {
		id: snapshot.id,
		fullName: typeof data.fullName === 'string' ? data.fullName : '',
		photoUrl: typeof data.photoUrl === 'string' ? data.photoUrl : undefined,
		graduationYear: typeof data.graduationYear === 'number' ? data.graduationYear : undefined,
		position: typeof data.position === 'string' ? data.position : undefined,
	bio: typeof data.bio === 'string' ? data.bio : undefined,
	authorSlug: typeof data.authorSlug === 'string' ? data.authorSlug : undefined,
	isHidden: typeof data.isHidden === 'boolean' ? data.isHidden : undefined,
	hasDeparted: typeof data.hasDeparted === 'boolean' ? data.hasDeparted : undefined,
	linkedArticleIds: Array.isArray(data.linkedArticleIds)
		? data.linkedArticleIds.filter((value) => typeof value === 'string')
		: undefined,
		lastUsedAt: convertTimestamp(data.lastUsedAt),
		createdAt: convertTimestamp(data.createdAt),
		updatedAt: convertTimestamp(data.updatedAt),
	};
};

const getAuthorDirectoryMap = async () => {
	const authorSnapshot = await getDocs(collection(db, "authors"));
	const authors = new Map();
	authorSnapshot.forEach((docSnapshot) => {
		const record = mapAuthorSnapshot(docSnapshot);
		if (record?.id) {
			authors.set(record.id, record);
		}
	});
	return authors;
};

const toSerializableStaffProfile = (record) => {
	if (!record || !record.id) {
		return null;
	}
	return {
		id: record.id,
		fullName: typeof record.fullName === 'string' ? record.fullName : '',
		photoUrl: typeof record.photoUrl === 'string' ? record.photoUrl : null,
		graduationYear: typeof record.graduationYear === 'number' ? record.graduationYear : null,
		position: typeof record.position === 'string' ? record.position : null,
		authorSlug: typeof record.authorSlug === 'string' ? record.authorSlug : null,
		isHidden: typeof record.isHidden === 'boolean' ? record.isHidden : false,
		hasDeparted: typeof record.hasDeparted === 'boolean' ? record.hasDeparted : false,
	};
};

const buildStaffData = (articleData, authorDirectory) => {
	const authorIds = Array.isArray(articleData?.authorIds)
		? articleData.authorIds
			.map((value) => (typeof value === 'string' ? value.trim() : ''))
			.filter((value) => value.length > 0)
		: [];

	const rawProfiles = authorIds
		.map((authorId) => authorDirectory.get(authorId))
		.filter(Boolean);

	const staffProfiles = rawProfiles
		.map(toSerializableStaffProfile)
		.filter((profile) => profile !== null);

	const canonicalNames = staffProfiles
		.map((record) => (typeof record.fullName === 'string' ? record.fullName.trim() : ''))
		.filter((name) => name.length > 0);

	const legacyNames = normalizeAuthorTokens(articleData?.author);
	const staffNames = canonicalNames.length > 0 ? canonicalNames : legacyNames;

	return {
		staffProfiles,
		staffNames,
		authorIds,
	};
};

export async function getAllArticleData() {
	// var urlify = require('urlify').create();
	const authorDirectory = await getAuthorDirectoryMap();
	const querySnapshot = await getDocs(collection(db, "articles"))

	const baseArticles = querySnapshot.docs.map((docSnapshot) => {
		const raw = docSnapshot.data() || {};
		const id = docSnapshot.id;
		const title = raw.title;
        const date = raw.date;
        const tags = raw.tags;
        const blurb = raw.blurb;
        const imageUrl = raw.imageUrl;
        const size = raw.size;
        const imageCredit = raw.imageCredit;
        const imageCaption = raw.imageCaption;
        const imageAltText = raw.imageAltText;
        const featuredImageId = typeof raw.featuredImageId === 'string' ? raw.featuredImageId : null;
        const viewCount = typeof raw.viewCount === 'number' && Number.isFinite(raw.viewCount) ? raw.viewCount : 0;
        const staffData = buildStaffData(raw, authorDirectory);
        return {
            id,
            date, 
            author: staffData.staffNames,
            authorIds: staffData.authorIds,
				staffProfiles: staffData.staffProfiles,
				staffNames: staffData.staffNames,
            title,
            tags,
			blurb,
			imageUrl,
			imageCredit,
            imageCaption: typeof imageCaption === 'string' ? imageCaption : '',
            imageAltText: typeof imageAltText === 'string' ? imageAltText : '',
			featuredImageId,
            size,
            viewCount,
			lastViewedAt: toIsoStringSafe(raw.lastViewedAt),
        };
	});

	const augmentedArticles = await Promise.all(
		baseArticles.map(async (article) => {
			const featuredImage = await resolveFeaturedImageForArticle(article.id, {
				featuredImageId: article.featuredImageId,
				legacyImageUrl: article.imageUrl,
			});

			const mergedImageUrl = featuredImage?.url || article.imageUrl || null;
				const mergedImageCredit = featuredImage?.credit || article.imageCredit || '';
				const mergedImageCaption = featuredImage?.caption || article.imageCaption || '';
				const mergedImageAltText = featuredImage?.altText || article.imageAltText || '';
				const resolvedFeaturedId = featuredImage?.id || article.featuredImageId || null;

				const serializedFeaturedImage = toSerializableImage(featuredImage);

				return {
					...article,
					imageUrl: mergedImageUrl,
					imageCredit: mergedImageCredit,
					imageCaption: mergedImageCaption,
					imageAltText: mergedImageAltText,
					featuredImageId: resolvedFeaturedId,
					featuredImage: serializedFeaturedImage,
				};
			})
		);

	return augmentedArticles.sort(({ date: a }, { date: b }) => {
		if (a < b) {
		  return 1;
		} else if (a > b) {
		  return -1;
		} else {
		  return 0;
		}
	  });
}

export async function getArticleData(id) {


}

export async function getArticleContent(id) {
	const article = await getDoc(doc(db, "articles", id));
	const cont = article.data() || {};
	const markdownRef = ref(storage, cont.path);
	const bytes = await getBytes(markdownRef);
	const dec = new TextDecoder();
	const rawMarkdown = dec.decode(bytes);

	const linkedImages = await getLinkedImagesForArticle(id);
	const { markdown: normalizedMarkdown, referencedImageIds = [] } = normalizeLegacyImageMarkdown(rawMarkdown, linkedImages);
	const rawImageMap = await getImagesByIds(referencedImageIds);
	const serializedImageMap = new Map();
	rawImageMap.forEach((record, key) => {
		if (!record) {
			return;
		}
		const serialized = toSerializableImage(record);
		if (serialized) {
			serializedImageMap.set(key, serialized);
		}
	});
	const markdownWithFigures = replaceImageTokensWithFigures(normalizedMarkdown, serializedImageMap);

	const matterResult = matter(markdownWithFigures);
	const processedContent = await remark().use(html, { sanitize: false }).process(matterResult.content);
	const contentHtml = processedContent.toString();
	const datas = matterResult.data;
	return {
		id,
		contentHtml,
		markdown: normalizedMarkdown,
		referencedImages: Array.from(serializedImageMap.values()).filter(Boolean),
		...datas,
	};
}

export async function getAdmins() {
	const ad = await getDoc(doc(db, "admin", "ids"));
 	const admins = ad.data().ids;
  	return {
    	admins
  	};
}

export const getAuthorDirectoryForServer = getAuthorDirectoryMap;
export const buildStaffDataForArticle = buildStaffData;

export const getLinkedImagesForArticle = async (articleId) => {
	if (!articleId) {
		return [];
	}
	const imagesRef = collection(db, 'images');
	const imageQuery = query(imagesRef, where('linkedArticleIds', 'array-contains', articleId));
	const snapshot = await getDocs(imageQuery);
	return snapshot.docs.map(mapImageSnapshot);
};

export const getImagesByIds = async (imageIds = []) => {
	const ids = Array.isArray(imageIds) ? imageIds.filter((id) => typeof id === 'string' && id.trim().length > 0) : [];
	if (ids.length === 0) {
		return new Map();
	}

	const results = await Promise.all(
		ids.map(async (imageId) => {
			try {
				const snapshot = await getDoc(doc(db, 'images', imageId));
				if (!snapshot.exists()) {
					return null;
				}
				return mapImageSnapshot(snapshot);
			} catch (error) {
				return null;
			}
		})
	);

	const map = new Map();
	results.forEach((record) => {
		if (record?.id) {
			map.set(record.id, record);
		}
	});
	return map;
};
