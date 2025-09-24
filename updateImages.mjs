// ES Module imports
import {configDotenv} from "dotenv";
configDotenv();
import admin from 'firebase-admin';
import {getFirestore, updateDoc, collection, getDocs, doc, getDoc} from 'firebase/firestore';
import { getStorage, getBytes, ref } from 'firebase/storage';
import { initializeApp } from "firebase/app"
import { TextDecoder } from 'util';
import matter from 'gray-matter';

const clientCredentials = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET, // we don't have this in the env, do we need this? what's it for
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let firebaseApp = initializeApp(clientCredentials);


// Usage
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://bifyellowpages-website-default-rtdb.firebaseio.com"
});

const db = getFirestore();
const storage = getStorage();

async function getArticleContent(id) {
    const article = await getDoc(doc(db, "articles", id));
    const cont = article.data();
    const markdownRef = ref(storage, cont.path);
    const bytes = await getBytes(markdownRef);
    const markdown = new TextDecoder().decode(bytes);
    const matterResult = matter(markdown);
    const imageRegex = /!\[.*?]\((.*?)\)/;
    const match = markdown.match(imageRegex);
    const imageUrl = match ? match[1] : null;

    // Dynamic imports for remark and remark-html
    const { remark } = await import('remark');
    const html = await import('remark-html');

    const processedContent = await remark()
        .use(html)
        .process(matterResult.content);

    const contentHtml = processedContent.toString();

    return {
        id,
        contentHtml,
        markdown,
        imageUrl,
        ...matterResult.data
    };
}

async function updateArticlesWithImageUrls() {
    const articlesRef = collection(db, "articles");
    const querySnapshot = await getDocs(articlesRef);
    const placeholderImageUrl = ''; // Or use a URL to a default/placeholder image
    let index = 0;
    for (const docSnapshot of querySnapshot.docs) {
        console.log(`Updating article with ID: ${docSnapshot.id}`);
        const articleContent = await getArticleContent(docSnapshot.id);
        const imageUrlToUpdate = articleContent.imageUrl || placeholderImageUrl;

        let size = 'normal';
        if (articleContent.imageUrl && index % 5 === 1) size = 'large';
        else if (index % 5 === 0) size = 'medium';
        else if (index % 9 === 0) size = 'small';

        await updateDoc(doc(db, "articles", docSnapshot.id), {
            imageUrl: imageUrlToUpdate,
            size: size
        });

        console.log(`Updated article with ID: ${docSnapshot.id} and size: ${size} index: ${index}`);
        index++;
    }

    console.log("All articles have been updated with image URLs and sizes.");
}

updateArticlesWithImageUrls().catch(console.error);
