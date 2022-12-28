import '../styles/global.css'
import Router from "next/router";
import React from 'react'
// import initAuth from '../initAuth' // the module you created above

// initAuth()
import AuthUserProvider from "../firebase/useUser";
import Loader from "../components/Loader";
import { useEffect, useState } from "react"
import Head from "next/head"
export default function App({ Component, pageProps }) {
  // return <AuthUserProvider><Component {...pageProps} /> </AuthUserProvider>
  const [loading, setLoading] = useState(false);
      useEffect(() => {
        const start = () => {
          console.log("start");
          setLoading(true);
        };
        const end = () => {
          console.log("finished");
          setLoading(false);
        };
        Router.events.on("routeChangeStart", start);
        Router.events.on("routeChangeComplete", end);
        Router.events.on("routeChangeError", end);
        return () => {
          Router.events.off("routeChangeStart", start);
          Router.events.off("routeChangeComplete", end);
          Router.events.off("routeChangeError", end);
        };
      }, []);
      return (
        <>
        <Head>
        <title>The Yellow Pages - The Student News Site of BASIS Independent Fremont</title>
        </Head>
          {loading ? (
            <Loader/>
          ) : (
            <AuthUserProvider><Component {...pageProps} /> </AuthUserProvider>
          )}
        </>
      ); 
}
