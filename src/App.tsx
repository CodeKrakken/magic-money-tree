import { useState, useEffect } from "react"
import Readout from "./components/Readout/Readout"
import Text from "./components/Text/Text"

export default function App() {

  interface item {
    id  : number,
    name: string
  }
  const [log, setLog] = useState([] as string[])

  useEffect(() => {
    const fetchLog = async () => {
      await fetch('/log')
        .then(response => response.json())
        .then(data => setLog(data))
    }
    
    fetchLog();
    const intervalId = setInterval(fetchLog, 1000);
  
    return () => clearInterval(intervalId);
  }, []);

  return <>
    <Text text='Magic Money Tree' tag='h1' />
    <Readout data={log} />
  </>
}