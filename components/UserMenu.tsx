import {getApp} from "firebase/app";
import {getFirestore} from "firebase/firestore";
import {getStorage} from "firebase/storage";
import {useUser} from "../firebase/useUser";
import {FiUser} from "react-icons/fi";

const app = getApp()
const db = getFirestore(app)
const storage = getStorage(app)

export default function UserMenu() {
    const user = useUser();
    return (
        <div className="relative">
            <FiUser size={24}/>
        </div>
    )
}