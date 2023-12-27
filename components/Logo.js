import Link from "next/link"
export default function Logo() {
    
    return (
        // <div className="mx-auto pt-2 px-2 hidden lg:block lg:justify-center h-min overflow-hidden max-h-12">
        <div>
        <div className="hidden lg:block pt-2 px-2 justify-center h-28 w-auto">
        
            <Link href="/">
                <img src='/images/yellowPages5.png' className = "object-contain h-full w-auto mx-auto"/>
            </Link>
        </div>
        </div>
    )
}

export function LogoIcon(){
    return (
        <div className="mx-auto pt-2 px-2 hidden lg:block lg:justify-center h-min overflow-hidden max-h-12">
            <Link href="/">
                <img src='/images/yellowpages.png' className="object-contain h-10 w-10 mx-auto"
                     alt={"Yellow Pages Logo"}/>
            </Link>
        </div>
    )
}