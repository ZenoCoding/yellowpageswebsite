import initFirebase from '../../firebase/initFirebase'
import { useEffect, useState } from 'react'
import StyledFirebaseAuth from 'react-firebaseui/StyledFirebaseAuth'
import firebase from 'firebase/app'
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from "firebase/auth";
import { setUserCookie } from '../../firebase/userCookies'
import { mapUserData } from '../../firebase/mapUserData'
import 'firebase/firestore'
import { useUser } from '../../firebase/useUser'

initFirebase() // initialize firebase

// const firebaseAuthConfig = {
//     signInFlow: 'popup',
//     // Auth providers
//     // https://github.com/firebase/firebaseui-web#configure-oauth-providers
//     signInOptions: [
//         // {
//         //     provider: getAuth().EmailAuthProvider.PROVIDER_ID
//         // },
//         // add additional auth flows below
//         getAuth().GoogleAuthProvider.PROVIDER_ID,
//         // firebase.auth.TwitterAuthProvider.PROVIDER_ID,
//         // firebase.auth.GithubAuthProvider.PROVIDER_ID,
//     ],
//     signInSuccessUrl: '/upload',
//     credentialHelper: 'none',
//     callbacks: {
//         signInSuccessWithAuthResult: async ({ user }, redirectUrl) => {
//             const userData = mapUserData(user)
//             setUserCookie(userData)
//             // alert('wtmoo')
//             // addUser(userData)
//         }
//     }
// }

const FirebaseAuth = () => {
    // Do not SSR FirebaseUI, because it is not supported.
    // https://github.com/firebase/firebaseui-web/issues/213
    // const [renderAuth, setRenderAuth] = useState(false)
    // useEffect(() => {
    //     if (typeof window !== 'undefined') {
    //         setRenderAuth(true)
    //     }
    // }, [])
    // return (
    //     <div>
    //         {renderAuth ? (
    //             <StyledFirebaseAuth
    //                 uiConfig={firebaseAuthConfig}
    //                 firebaseAuth={firebase.auth()}
    //             />
    //         ) : null}
    //     </div>
    // )

  
  const auth = getAuth();
  const provider = new GoogleAuthProvider();
  signInWithPopup(auth, provider)
  .then((result) => {
    // This gives you a Google Access Token. You can use it to access the Google API.
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const token = credential.accessToken;
    // The signed-in user info.
    const user = result.user;
    // console.log(user);
    // ...
  }).catch((error) => {
    // Handle Errors here.
    const errorCode = error.code;
    const errorMessage = error.message;
    // The email of the user's account used.
    const email = error.customData.email;
    // The AuthCredential type that was used.
    const credential = GoogleAuthProvider.credentialFromError(error);
    // ...
  });
  return null;
}

export default FirebaseAuth