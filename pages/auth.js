import FirebaseAuth from "../components/auth/FirebaseAuth";
import {useUser} from "../firebase/useUser";
import Link from "next/link";

import {useRouter} from "next/router";
import Loading from "../components/Loader";
import ContentNavbar from "../components/ContentNavbar";

const Auth = () => {
    const {user} = useUser();
    const router = useRouter();
    if (user === null) {
        return <Loading/>;
    }
    if (user !== undefined) {
        router.replace({
            pathname: '/upload',
        });
        return null;
    }
    return (

        <div className="flex h-screen justify-center items-center">
            <ContentNavbar/>
            <div className= "flex flex-col items-center gap-8 w-full">
                <div className={"w-full"}>
                    <FirebaseAuth/>
                </div>
                <Link href={"/auth"} className="italic text-xl hover:underline hover:text-indigo-600">
                    Popup blocked?
                </Link>
                <Link href={"/"} className="font-medium text-indigo-900 hover:underline hover:text-indigo-600">
                    &larr; Go Home
                </Link>
            </div>
        </div>
    );
};

export default Auth;