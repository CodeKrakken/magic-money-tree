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

  useEffect(() => {
    const fetchData = async () => {
      await fetch('/data')
      .then(response => response.json())
      .then(data => {
        setWallet(data.wallet)
        setcurrentTask(data.currentTask)
        setTransactionLog(data.transactionLog)
      })
    }
    
    fetchData();
    const intervalId = setInterval(fetchData, 200);
  
    return () => clearInterval(intervalId);
  }, []);

  console.log(wallet)

  return <>
    <Text text='Magic Money Tree' tag='h1' />
    <CurrentTask currentTask={currentTask} />
    <Wallet wallet={wallet} />
    <br />
    {transactionLog.length ? <TransactionLog log={transactionLog} /> : null}
    <br />
    {
      wallet?.data?.currentMarket
      ? <MarketGraph history={wallet.data.currentMarket.histories.seconds} />
      : null
    }
  </>
}