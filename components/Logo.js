import Link from "next/link"
export default function Logo({ className }) {
    return (
        <div className={`${className} px-4 flex items-center justify-center h-28`}>
            <Link href="/" className="w-full flex justify-center"> {/* Ensures the link itself is also centered */}
                <img src='/images/yellowPages5.png'
                     className="object-contain h-auto max-w-full md:w-10/12 lg:w-3/4 xl:w-3/5"
                     alt="Yellow Pages Logo"/>
            </Link>
        </div>
    );
}


export function LogoIcon() {
    return (
        <div className="mx-auto pt-2 px-2 h-min overflow-hidden max-h-12">
            <Link href="/">
                <img src='/images/yellowpages.png' className="object-contain h-10 w-10 mx-auto"
                     alt="Yellow Pages Logo"/>
            </Link>
        </div>
    )
}