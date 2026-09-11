const Log = (
  log: string[]
) => {

  return <div>
    {
      log.map((item, i) => (
        <div key={i}>
          {item}
        </div>
      ))
    }
  </div>
};

export default Log;