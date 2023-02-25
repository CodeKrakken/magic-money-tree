import { useState, useEffect } from "react"
import Readout from "./components/Readout/Readout"
import Text from "./components/Text/Text"
import { wallet } from 'server'
import Wallet from "./components/Wallet/Wallet"

export default function App() {

  interface item {
    id  : number,
    name: string
  }

  const [log, setLog] = useState([] as string[])  
  const [wallet, setWallet] = useState({} as wallet)

  useEffect(() => {
    const fetchLog = async () => {
      await fetch('/data')
      .then(response => response.json())
      .then(data => {
        setLog(data.log)
        setWallet(data.wallet)
      })
    }
    
    fetchLog();
    const intervalId = setInterval(fetchLog, 1000);
  
    return () => clearInterval(intervalId);
  }, []);

  return <>
    <Text text='Magic Money Tree' tag='h1' />
    <Readout data={log} />
    <Wallet wallet={wallet} />
  </>
}