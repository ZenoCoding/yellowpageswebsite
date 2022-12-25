import logo from "../public/images/yellowPages5.png"
import Link from "next/link"
import Image from "next/image"
export default function Logo() {
    
    return (
        // <div className="mx-auto pt-2 px-2 hidden lg:block lg:justify-center h-min overflow-hidden max-h-12">
        <div>
        <div className="hidden lg:block pt-2 px-2 justify-center h-28">
        
            <a href="/">
            <img src='/images/yellowPages5.png' className = "object-contain h-full w-full"/>
            </a> 
        </div>
        </div>
    )
}