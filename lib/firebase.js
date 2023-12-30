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
export async function getAllArticleData() {
	
	// var urlify = require('urlify').create();
	const res = []
	const upd = []
	const querySnapshot = await getDocs(collection(db, "articles"))
	querySnapshot.forEach((doc) => {
		// console.log(`${doc.id} => ${doc.data().title}`)
		const id = doc.id
		const title = doc.data().title
		const author = doc.data().author
		const date = doc.data().date
		const tags = doc.data().tags
		const blurb = doc.data().blurb
		const imageUrl = doc.data().imageUrl
		const size = doc.data().size
		res.push({
			id,
			date, 
			author,
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