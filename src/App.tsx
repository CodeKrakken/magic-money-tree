import { useState, useEffect } from "react"
import Log from "./components/Log/Log"
import Text from "./components/Text/Text"
import { wallet } from 'server'
import Wallet from "./components/Wallet/Wallet"
import CurrentTask from "./components/CurrentTask/CurrentTask"

export default function App() {

  const [wallet,   setWallet] = useState({} as wallet)
  const [currentTask, setcurrentTask] = useState('Fetching data')

  useEffect(() => {
    const fetchData = async () => {
      await fetch('/data')
      .then(response => response.json())
      .then(data => {
        setWallet(data.wallet)
        setcurrentTask(data.currentTask)
      })
    }
    
    fetchData();
    const intervalId = setInterval(fetchData, 1000);
  
    return () => clearInterval(intervalId);
  }, []);

  return <>
    <Text text='Magic Money Tree' tag='h1' />
    <Wallet wallet={wallet} />
    <br />
    <CurrentTask currentTask={currentTask} />
  </>
}