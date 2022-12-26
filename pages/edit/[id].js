import { getArticleContent, getAllArticleIds, getAdmins } from '../../lib/firebase'
import Date from '../../components/date'
import { getApp } from "firebase/app"
import { doc, getFirestore, collection, getDocs, getDoc, updateDoc } from "firebase/firestore"
import { getDownloadURL, getStorage, getStream, ref, getBytes, uploadBytesResumable } from "firebase/storage";
import matter from 'gray-matter';
import { remark } from 'remark';
import { useRouter } from 'next/router'; 
import { getAuth, signOut } from "firebase/auth";
import { useUser } from "../../firebase/useUser";
import { useReducer, useState } from 'react'
import html from 'remark-html';
import Link from 'next/link'
import { parseISO, format } from 'date-fns'
import { checkCategory } from '../../lib/checkCategory'
import { checkBlurb } from '../../lib/checkBlurb'
import { makeCommaSeparatedString } from '../../lib/makeCommaSeparatedString'

//reinstating, not in lib/firebase cause fs being stinky
const app = getApp()
const db = getFirestore(app)
const storage = getStorage(app)


export default function Post({ content, admins }) {
//then  get the textfield changes from here
const auth = getAuth();
const { user } = useUser();
const router = useRouter();
  const articleId = router.query.id
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










  const [formData, setFormData] = useState(content.markdown);
  const [htmlData, setHtmlData] = useState(content.contentHtml);
  const [titleData, setTitleData] = useState(content.title);
  const [dateData, setDateData] = useState(content.date);
  const [errorData, setErrorData] = useState("");
  const [authorData, setAuthorData] = useState(makeCommaSeparatedString(content.author, true));
  const [tagsData, setTagsData] = useState(makeCommaSeparatedString(content.tags, true));
  const [uploadData, setUploadData] = useState("")
  const [blurbLen, setBlurbLen] = useState(0)
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
      // console.log(matterResult.data.tags);
      // console.log(checkCategory(matterResult.data.tags));
      if (!checkCategory(matterResult.data.tags)) {
        throw "Invalid Category";
      }
      if (!checkBlurb(matterResult.data.blurb)) {
        throw "Invalid Blurb. Max length 200 chars, current length: " + matterResult.data.blurb.length + ' chars';
      }
      setTagsData(matterResult.data.tags);
      
    }
    catch (e) {
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
    console.log(articleId);
    const article = await getDoc(doc(db, "articles", articleId.toString()));
    const cont = article.data();
    const markdownRef = ref(storage, cont.path);

    const matterResult = matter(formData);


    await updateDoc(doc(db, "articles", articleId), {
      date: matterResult.data.date,
      author: matterResult.data.author,
      title: matterResult.data.title,
      tags: matterResult.data.tags,
      blurb: matterResult.data.blurb
      });
    var file = new Blob([formData], { type: "text/plain" });
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
          setUploadData("Upload Successful! Article page should now display your edits.");
        });
      }
    );
  }




  return (
        
      <div className="m-auto max-w-2xl my-10  px-5">
        <style jsx global>{`
        a {
          color: rgb(59 130 246);
        }
        a:hover {
          text-decoration: underline;
        }
      `}</style>
        <h1 className = "text-4xl mb-1">{titleData}</h1>
        <div className="text-gray-500">
          <Date dateString={dateData} />
        </div>
        <div className="text-gray-500 mb-4">
          By {authorData}
        </div>
        
        <div dangerouslySetInnerHTML={{ __html: htmlData}} />
        <div className="hover:underline text-blue-500 mb-5">
          <Link href="/">
            <a>← Back</a>
          </Link>
          
        </div>
        <textarea type="text" id="updateText" value={formData} onChange = {async () => await update()}/> 
        <div>The blurb is currently {blurbLen} characters long.</div>
        <div className="text-red-500">{errorData}</div>
        <br></br>
        <div><i>If you wanna reset all your changes to the original version cause you really messed up, just reload the page</i></div>
        <div onClick={async () => await upload()}>If you wanna submit your changes and update the article (<b>MAKE SURE TO NOT SUBMIT IF THERE ARE ERRORS!</b>), click this - <button>Submit</button></div>
        <div className="font-bold italic">{uploadData}</div>
      </div>
      
  )
}

// export async function getStaticPaths() {
//   console.log("getting paths...")
//   const paths = await getAllArticleIds()
//   console.log(paths)
//   return {
//     paths,
//     fallback: false
//   }
// }

export async function getServerSideProps({ params }) {
  const content = await getArticleContent(params.id)
  console.log(content)
  const admins = await getAdmins();
  const ret = admins.admins;
  return {
    props: {
      content,
      admins: ret
    }
  }
}
