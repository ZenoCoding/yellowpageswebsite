import Date from '../components/date'
import { getAdmins } from '../lib/firebase'
import { getApp } from "firebase/app"
import { doc, getFirestore, collection, getDocs, getDoc, updateDoc, setDoc } from "firebase/firestore"
import { getDownloadURL, getStorage, getStream, ref, getBytes, uploadBytes } from "firebase/storage";
import matter from 'gray-matter';
import { remark } from 'remark';
import { useRouter } from 'next/router'; 
import { getAuth, signOut } from "firebase/auth";
import { useUser } from "../firebase/useUser";
import { useReducer, useState } from 'react'
import html from 'remark-html';
import Link from 'next/link'
import { parseISO, format } from 'date-fns'

// var user_id = null;

//reinstating, not in lib/firebase cause fs being stinky
const app = getApp()
const db = getFirestore(app)
const storage = getStorage(app)

export default function Upload({ admins }) {
  const auth = getAuth();
  const { user } = useUser();
  const router = useRouter();
  if (user == null) {
    return (<div>You're not logged in my man</div>)
  }
  if (user == undefined) {
    return <Loading />
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
    return (<div>Sry you're not authorized.<Link legacyBehavior href="/">
    <a onClick={(e) => handleClick(e)}>
          Sign out
        </a>
  </Link> </div> )
  }
  

  const makeCommaSeparatedString = (arr, useOxfordComma) => {
    if (arr == null || arr.length == 0) {
        return ""
    }
    const listStart = arr.slice(0, -1).join(', ')
    const listEnd = arr.slice(-1)
    const conjunction = arr.length <= 1 
      ? '' 
      : useOxfordComma && arr.length > 2 
        ? ', and ' 
        : ' and '
  
    return [listStart, listEnd].join(conjunction)
  }


  const [formData, setFormData] = useState(`---
title: "Placeholder Title"
date: "1000-01-01"
author: [""]
tags: []
---
`);
  const [htmlData, setHtmlData] = useState("");
  const [titleData, setTitleData] = useState("Placeholder Title");
  const [dateData, setDateData] = useState("1000-01-01");
  const [errorData, setErrorData] = useState("");
  const [authorData, setAuthorData] = useState(makeCommaSeparatedString([""], true));
  // console.log(content)
  // const handleTextChange = event => {
  //   // 👇️ access textarea value
  //   setFormData(event.target.value);
  // };
  async function update() {
    setFormData(document.getElementById('updateText').value);
    var matterResult = null;
    try {
    matterResult = matter(document.getElementById('updateText').value);
    }
    catch (e) {
      setErrorData("Something's wrong with the way you formatted the title or author or date");
      return;
    }
	// Use remark to convert markdown into HTML string
    const processedContent = await remark()
      .use(html)
      .process(matterResult.content);
    setTitleData(matterResult.data.title);
    try {
      const dats = parseISO(matterResult.data.date)
      format(dats, 'LLLL d, yyyy');
      setDateData(matterResult.data.date);
    }
    catch (e) {
      setErrorData("Something's wrong with the way you formatted the title or author or date");
      return;
      // console.log(e)
    }
    setAuthorData(makeCommaSeparatedString(matterResult.data.author, true))
    const contentHtml = processedContent.toString();
    setHtmlData(contentHtml);
    setErrorData("");
    // console.log(event.target.value);
  }




  async function upload() {
    // uploadMarkdown(formData, articleId);
    
    
    var urlify = require('urlify').create({
      addEToUmlauts:true,
      szToSs:true,
      spaces:"_",
      nonPrintable:"_",
      trim:true
    });

    const matterResult = matter(formData);
    const dat = parseISO(matterResult.data.date)
    const articleId =  format(dat, 'yyyy-MM-dd') + '_' + urlify(matterResult.data.title)
    console.log(articleId);
    // const cont = article.data();
    const path = "articles/" + articleId + ".md"
    const markdownRef = ref(storage, path);
    await setDoc(doc(db, "articles", articleId), {
      date: matterResult.data.date,
      author: matterResult.data.author,
      title: matterResult.data.title,
      path
      });
    var file = new Blob([formData], { type: "text/plain" });
    const uploadTask = uploadBytes(markdownRef, file);
  }

  return (
    <div className="bg-white">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:max-w-7xl lg:px-8">
      <div><div>Wow! What an ugly upload page! Maybe I'll make it look better some other day. <br/>
      <Link legacyBehavior href="/">
        <a onClick={(e) => handleClick(e)}>
          Sign out
        </a>
      </Link>  
      </div>
      <br/>
      <div>Here are some basic instructions: <a href="https://docs.google.com/document/d/1_lNHBxtpaBa1JRqrbapmCj_L_k-yfSsTSkgGp_1pnL0/edit?usp=sharing">Google Docs Link</a></div>

      <textarea type="text" id="updateText" value={formData} onChange = {async () => await update()}/> 
      {errorData}
      <div onClick={async () => await upload()}>If you wanna upload this article, click this - <button>Submit</button></div>
      
      <h1>Below is the drafted article: </h1> 
      <div>
        <hr className="my-10 bg-gray-900 dark:bg-gray-200"/> 
        </div>
      <article>
      <h1 className = "text-4xl mb-1">{titleData}</h1>
      <div className="text-gray-500">
          <Date dateString={dateData} />
        </div>
        <div className="text-gray-500 mb-4">
          By {authorData}
        </div>
        
        <div dangerouslySetInnerHTML={{ __html: htmlData }} />
      </article>
        </div>
    </div>
</div>
)};

export async function getStaticProps({ params }) {
  const admins = await getAdmins();
  const ret = admins.admins;
  return {
    props: {
      admins: ret
    }
  }
}
// export async function getServerSideProps () {
//   const { user } = useUser();
//   // const user = {id: 1, email: "fdsa", name: "john"}
//   console.log("logging user")

//   return {
//     props: {
//       userCloset,
//     },
//   }
// }