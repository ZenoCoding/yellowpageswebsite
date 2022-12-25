import '../styles/global.css'
// import initAuth from '../initAuth' // the module you created above

// initAuth()
import AuthUserProvider from "../firebase/useUser";
export default function App({ Component, pageProps }) {
  return <AuthUserProvider><Component {...pageProps} /> </AuthUserProvider>
    
}
