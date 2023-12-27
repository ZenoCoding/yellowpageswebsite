const Loader = () => {
    return (
      <div className="hero container w-screen h-screen m-auto">
        {/* <h1 className="text-6xl text-center font-light">
          Loading...
        </h1> */}
        <img src="/images/yellowpages.png" className = "absolute loading w-14 h-14 left-1/2 bottom-1/2"></img>
      </div>
    );
  };
  
  export default Loader;