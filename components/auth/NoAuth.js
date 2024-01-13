import Link from "next/link";
import {GoSignIn} from "react-icons/go";
import ContentNavbar from "../ContentNavbar";

export default function NoAuth({permission=false}) {
  return (
      <div>
          <ContentNavbar/>
          <div className="flex h-screen justify-center items-center -mt-16">
              <div className="flex w-1/2 m-auto items-center justify-center">
                  <div className="">
                      <h1 className="text-9xl ">Oops!</h1>
                      <p className="mt-6">
                          {permission && `You don't have permission to view this page.`}
                          {!permission && `You need to be signed in to view this page.`}
                      </p>
                      {!permission && <button className="flex rounded-xl border-2 border-black font-bold px-6 py-4 items-center">
                          <Link href="/auth" className="">
                              Sign In
                          </Link>
                          <GoSignIn className="ml-2" />
                      </button>}
                  </div>
                  <img src="/images/auth.png" alt="auth" className="mt-10 hidden md:block align-middle" />
              </div>
          </div>
      </div>
  );
}