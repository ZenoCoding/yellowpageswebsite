import { initFirebase } from "../firebase/initFirebase.js"
import { getApp } from "firebase/app"
import { doc, getFirestore, collection, getDocs, getDoc } from "firebase/firestore"
import { getDownloadURL, getStorage, getStream, ref, getBytes } from "firebase/storage";
import matter from 'gray-matter';
import { remark } from 'remark';
import html from 'remark-html';


const app = getApp()
const db = getFirestore(app)
const storage = getStorage(app)

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
	const res = []
	const upd = []
	const authorDirectory = await getAuthorDirectoryMap();
	const querySnapshot = await getDocs(collection(db, "articles"))
	querySnapshot.forEach((doc) => {
		// console.log(`${doc.id} => ${doc.data().title}`)
		const id = doc.id
		const title = doc.data().title
        const date = doc.data().date
        const tags = doc.data().tags
        const blurb = doc.data().blurb
        const imageUrl = doc.data().imageUrl
        const size = doc.data().size
		const staffData = buildStaffData(doc.data(), authorDirectory);
        res.push({
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
			size
		})
		upd.push({
			params: {id: doc.id},
		},)
	})

	return res.sort(({ date: a }, { date: b }) => {
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
	// console.log("fetching...")
	const article = await getDoc(doc(db, "articles", id))
	const cont = article.data()
	// cont.date = cont.date.toDate().toISOString().substr(0,10)

	
	const markdownRef = ref(storage, cont.path)
	// console.log(article.data().path)

	const bytes = await getBytes(markdownRef);
	// console.log(bytes)

	const dec = new TextDecoder();
	const markdown = dec.decode(bytes);
	// console.log(markdown);

	const matterResult = matter(markdown);
	// console.log(matterResult);
	// Use remark to convert markdown into HTML string
	const processedContent = await remark()
		.use(html)
		.process(matterResult.content);
	const contentHtml = processedContent.toString();
	const datas = matterResult.data
	return {
		id,
		contentHtml,
		markdown,
		...datas
	}
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
