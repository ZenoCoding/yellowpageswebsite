import { initFirebase } from "../firebase/initFirebase.js"
import { getApp } from "firebase/app"
import { doc, getFirestore, collection, getDocs, getDoc } from "firebase/firestore"
import { getDownloadURL, getStorage, getStream, ref, getBytes } from "firebase/storage";
// import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { remark } from 'remark';
import html from 'remark-html';
// const firebaseConfig = {
// 	apiKey: "AIzaSyB1fgZoQxuOlrakM_HDnSBFXsXcuJyeJ9E",
// 	authDomain: "bifyellowpages-website.firebaseapp.com",
// 	projectId: "bifyellowpages-website",
// 	storageBucket: "bifyellowpages-website.appspot.com",
// 	messagingSenderId: "971157057889",
// 	appId: "1:971157057889:web:7a9f0cb88fb7e803f05520",
// 	measurementId: "G-GNCPCMKHZS"
// }

const app = getApp()
const db = getFirestore(app)
const storage = getStorage(app)
export async function getAllArticleData() {
	
	// var urlify = require('urlify').create();
	var res = []
	var upd = []
	const querySnapshot = await getDocs(collection(db, "articles"))
	querySnapshot.forEach((doc) => {
		console.log(`${doc.id} => ${doc.data().title}`)
		const id = doc.id
		const title = doc.data().title
		const author = doc.data().author
		const date = doc.data().date
		const tags = doc.data().tags
		res.push({
			id,
			date, 
			author,
			title,
			tags
		})
		upd.push({
			params: {id: doc.id},
		},)
	})
	// const fs = await require("fs");
	// const upd_data = JSON.stringify(upd)
	// fs.writeFile('ids.json', upd_data, err => {
	// if (err) {
	// 	throw err
	// }
	// console.log('JSON data is saved.')
	// })
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
export async function getArticleContent(id) {
	console.log("fetching...")
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

// export async function getAllArticleIds() {
// 	const fs = await require("fs");
// 	const upd = fs.readFileSync("ids.json");
//   	const upd_data = JSON.parse(upd);
// 	return upd_data
	// return upd
	// Returns an array that looks like this:
	// [
	//   {
	//     params: {
	//       id: 'ssg-ssr'
	//     }
	//   },
	//   {
	//     params: {
	//       id: 'pre-rendering'
	//     }
	//   }
	// ]
	// return fileNames.map((fileName) => {
	//   return {
	// 	params: {
	// 	  id: fileName.replace(/\.md$/, ''),
	// 	},
	//   };
	// });
//   }

//   export async function uploadMarkdown(fileStr, id) {
// 	const article = await getDoc(doc(db, "articles", id))
// 	const markdownRef = ref(storage, article.data().path)

// 	const matterResult = matter(fileStr);


// 	await updateDoc(doc(db, "articles", id), {
// 		date: matterResult.data.date,
// 		author: matterResult.data.author,
// 		title: matterResult.data.title
// 	  });
// 	var file = new Blob([fileStr], { type: "text/plain" });
// 	markdownRef.put(file);
//   }