import {useState} from "react";

export default function Loader() {
    // make a timer so that if the loader takes too long, it will show up
    const [hasTimeout, setHasTimeout] = useState(false);
    setTimeout(() => {
        // if the loader is still loading, then show it
        setHasTimeout(true);
    }, 2000);


    return (
        <div className="hero container w-screen h-screen m-auto">
            <img src="/images/yellowpages.png" className="absolute loading w-14 h-14 left-1/2 bottom-1/2"></img>
            {hasTimeout &&
                <small
                    className="absolute left-1/2 bottom-1/3 text-center text-gray-500 italic text-sm"
                    style={{ transform: 'translate(-50%, -20%)' }}
                >
                    Trouble Loading?<br/>
                    Please check your internet connection.
                </small>}
        </div>
    );
}