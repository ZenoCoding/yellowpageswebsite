import Date from '../components/date'
import {getAdmins} from '../lib/firebase'
import {getApp} from "firebase/app"
import {doc, getFirestore, setDoc} from "firebase/firestore"
import {getDownloadURL, getStorage, ref, uploadBytesResumable} from "firebase/storage";
import matter from 'gray-matter';
import {remark} from 'remark';
import {useRouter} from 'next/router';
import {getAuth, signOut} from "firebase/auth";
import {useUser} from "../firebase/useUser";
import {useState} from 'react'
import html from 'remark-html';
import Link from 'next/link'
import {format, parseISO} from 'date-fns'
import {checkCategory} from '../lib/checkCategory'
import {checkBlurb} from '../lib/checkBlurb'
import {makeCommaSeparatedString} from '../lib/makeCommaSeparatedString'

// var user_id = null;

//reinstating, not in lib/firebase cause fs being stinky
const app = getApp()
const db = getFirestore(app)
const storage = getStorage(app)

export default function Upload({admins}) {
    const auth = getAuth();
    const {user} = useUser();
    const router = useRouter();
    if (user == null) {
        return (<div>You're not logged in my man</div>)
    }
    if (user == undefined) {
        return <Loading/>
    }
    // console.log(admins);
    const inc = Array.from(admins).includes(user.id);
    const handleClick = (e) => {
        signOut(auth).then(() => {
            // Sign-out successful.
        }).catch((error) => {
            // An error happened.
        });
    };
    if (!inc) {
        return (
            <div>Sry you're not authorized.
                <Link legacyBehavior href="/" className="border-2" onClick={(e) => handleClick(e)}>
                    Sign out
                </Link>
            </div>
        )
    }


    const [formData, setFormData] = useState(`---
title: "Placeholder Title"
date: "1000-01-01"
author: [""]
tags: [""]
blurb: ""
---
`);
    const [htmlData, setHtmlData] = useState("");
    const [titleData, setTitleData] = useState("Placeholder Title");
    const [dateData, setDateData] = useState("1000-01-01");
    const [errorData, setErrorData] = useState("");
    const [authorData, setAuthorData] = useState(makeCommaSeparatedString([""], true));
    const [uploadData, setUploadData] = useState("")
    const [tagsData, setTagsData] = useState("")
    const [blurbLen, setBlurbLen] = useState(0)
    async function update() {
        setFormData(document.getElementById('updateText').value);
        var matterResult = null;
        try {
            matterResult = matter(document.getElementById('updateText').value);
        } catch (e) {
            setErrorData("Something's wrong with the way you formatted the title or author or date or text or categories...check the instruction docs again...or try to read the error statement below \n" + e);
            return;
        }
        // Use remark to convert markdown into HTML string
        try {
            const dats = parseISO(matterResult.data.date)
            setBlurbLen(matterResult.data.blurb.length);
            format(dats, 'LLLL d, yyyy');
            setDateData(matterResult.data.date);
            setTitleData(matterResult.data.title);
            makeCommaSeparatedString(matterResult.data.author, true)
            setAuthorData(makeCommaSeparatedString(matterResult.data.author, true))
            const processedContent = await remark()
                .use(html)
                .process(matterResult.content);
            const contentHtml = processedContent.toString();
            setHtmlData(contentHtml);
            if (!checkCategory(matterResult.data.tags)) {
                throw "Invalid Category";
            }
            if (!checkBlurb(matterResult.data.blurb)) {
                throw "Invalid Blurb. Max length 200 chars, current length: " + matterResult.data.blurb.length + ' chars';
            }
            setTagsData(matterResult.data.tags);
        } catch (e) {
            setErrorData("Something's wrong with the way you formatted the title or author or date or text or categories...check the instruction docs again...or try to read the error statement below \n" + e);
            return;
            // console.log(e)
        }


        setErrorData("");
        // console.log(event.target.value);
    }


    async function upload() {
        // uploadMarkdown(formData, articleId);
        if (errorData != "") {
            setUploadData("There's unresolved errors bro.")
            return;
        }

        var urlify = require('urlify').create({
            addEToUmlauts: true,
            szToSs: true,
            spaces: "_",
            nonPrintable: "_",
            trim: true
        });

        const matterResult = matter(formData);
        const dat = parseISO(matterResult.data.date)
        const articleId = format(dat, 'yyyy-MM-dd') + '_' + urlify(matterResult.data.title)
        console.log(articleId);
        // const cont = article.data();
        const path = "articles/" + articleId + ".md"
        const markdownRef = ref(storage, path);
        await setDoc(doc(db, "articles", articleId), {
            date: matterResult.data.date,
            author: matterResult.data.author,
            title: matterResult.data.title,
            tags: matterResult.data.tags,
            blurb: matterResult.data.blurb,
            path
        });
        var file = new Blob([formData], {type: "text/plain"});
        const uploadTask = uploadBytesResumable(markdownRef, file);
        uploadTask.on('state_changed',
            (snapshot) => {
                // Get task progress, including the number of bytes uploaded and the total number of bytes to be uploaded
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                setUploadData('Upload is ' + progress + '% done');
                switch (snapshot.state) {
                    case 'paused':
                        setUploadData('Upload is paused');
                        break;
                    case 'running':
                        setUploadData('Uploading...');
                        break;
                }
            },
            (error) => {
                // A full list of error codes is available at
                // https://firebase.google.com/docs/storage/web/handle-errors
                switch (error.code) {
                    case 'storage/unauthorized':
                        // User doesn't have permission to access the object
                        break;
                    case 'storage/canceled':
                        // User canceled the upload
                        break;

                    // ...

                    case 'storage/unknown':
                        // Unknown error occurred, inspect error.serverResponse
                        break;
                }
            },
            () => {
                // Upload completed successfully, now we can get the download URL
                getDownloadURL(uploadTask.snapshot.ref).then((downloadURL) => {
                    setUploadData("Upload Successful! Redirecting to submitted article page...in 5 seconds");
                });

                function callback() {
                    return function () {
                        router.push('/posts/' + articleId);
                    }
                }

                setTimeout(callback(), 6000);


            }
        );
    }

    return (
        <div className="bg-white">
            <style jsx global>{`
                a {
                    color: rgb(59 130 246);
                }

                a:hover {
                    text-decoration: underline;
                }
            `}</style>
            <div className="m-auto max-w-2xl my-10">
                <div>
                    <div>Wow! What an ugly upload page! Maybe I'll make it look better some other day. <br/>
                        <Link legacyBehavior href="/" className="border-2" onClick={(e) => handleClick(e)}>
                            Sign out
                        </Link>
                    </div>
                    <br/>
                    <div>Here are some basic instructions: <a className="underline"
                                                              href="https://docs.google.com/document/d/1_lNHBxtpaBa1JRqrbapmCj_L_k-yfSsTSkgGp_1pnL0/edit?usp=sharing">Google
                        Docs Link</a></div>

                    <textarea type="text" id="updateText" value={formData} onChange={async () => await update()}/>
                    <div>The blurb is currently {blurbLen} characters long.</div>
                    <div className="text-red-500">{errorData}</div>
                    <div onClick={async () => await upload()}>If you wanna upload this article, click this
                        - <button>Submit</button></div>
                    <div className="font-bold italic">{uploadData}</div>
                    <br></br>
                    <h1>Below is the drafted article: </h1>
                    <div>
                        <hr className="my-5 bg-gray-900 dark:bg-gray-200"/>
                    </div>
                    <article>
                        <h1 className="text-4xl mb-1">{titleData}</h1>
                        <div className="text-gray-500">
                            <Date dateString={dateData}/>
                        </div>
                        <div className="text-gray-500 mb-4">
                            {authorData}
                        </div>

                        <div dangerouslySetInnerHTML={{__html: htmlData}}/>
                    </article>
                </div>
            </div>
        </div>
    )
};

export async function getServerSideProps({params}) {
    const admins = await getAdmins();
    const ret = admins.admins;
    return {
        props: {
            admins: ret
        }
    }
}