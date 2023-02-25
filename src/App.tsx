import { useState, useEffect } from "react"
import Log from "./components/Log/Log"
import Text from "./components/Text/Text"
import { wallet } from 'server'
import Wallet from "./components/Wallet/Wallet"
import Current from "./components/Current.tsx/Current"

export default function App() {

  const [log,         setLog] = useState([] as string[])  
  const [wallet,   setWallet] = useState({} as wallet)
  const [current, setCurrent] = useState('Fetching data')

  useEffect(() => {
    const fetchData = async () => {
      await fetch('/data')
      .then(response => response.json())
      .then(data => {
        setLog(data.log)
        setWallet(data.wallet)
        setCurrent(data.log[data.log.length-1])
      })
    }
    
    fetchData();
    const intervalId = setInterval(fetchData, 1000);
  
    return () => clearInterval(intervalId);
  }, []);

  return <>
    <Text text='Magic Money Tree' tag='h1' />
    <Wallet wallet={wallet} />
    <Current current={current} />
  </>
}