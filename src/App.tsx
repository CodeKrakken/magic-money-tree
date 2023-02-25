import { useState, useEffect } from "react"
import Log from "./components/Log/Log"
import Text from "./components/Text/Text"
import { wallet } from 'server'
import Wallet from "./components/Wallet/Wallet"
import CurrentTask from "./components/CurrentTask/CurrentTask"
import TransactionLog from "./components/TransactionLog/TransactionLog"
import MarketGraph from "./components/MarketGraph/MarketGraph"
import { indexedFrame } from "server"

export default function App() {

  const [wallet,                 setWallet] = useState({} as wallet)
  const [currentTask,       setcurrentTask] = useState('Fetching data')
  const [transactionLog, setTransactionLog] = useState([] as string[])
  const [histories,           setHistories] = useState({} as {[key: string]: indexedFrame[]})

  useEffect(() => {
    const fetchData = async () => {
      await fetch('/data')
      .then(response => response.json())
      .then(data => {
        setWallet(data.wallet)
        setcurrentTask(data.currentTask)
        setTransactionLog(data.transactionLog)
        setHistories(data.histories)
      })
    }
    
    fetchData();
    const intervalId = setInterval(fetchData, 200);
  
    return () => clearInterval(intervalId);
  }, []);

  return <>
    <Text text='Magic Money Tree' tag='h1' />
    <CurrentTask currentTask={currentTask} />
    <Wallet wallet={wallet} />
    <br />
    <TransactionLog log={transactionLog} />

    {
      histories && <MarketGraph history={histories['seconds']} />
    }
  </>
}