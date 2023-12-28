import Link from "next/link"
export default function Logo({ className }) {
    return (
        <div className={`${className} pt-7 mx-10 lg:mx-20justify-center h-28`}>
            <Link href="/">
                <img src='/images/yellowPages5.png'
                     className="object-contain h-auto mx-auto lg:w-3/4 xl:w-3/5"
                     alt="Yellow Pages Logo"/>
            </Link>
        </div>
    )
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