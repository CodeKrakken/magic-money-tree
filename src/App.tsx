import { useState, useEffect } from "react"
import Log from "./components/Log/Log"
import Text from "./components/Text/Text"
import { wallet } from 'server'
import Wallet from "./components/Wallet/Wallet"
import CurrentTask from "./components/CurrentTask/CurrentTask"
import TransactionLog from "./components/TransactionLog/TransactionLog"
import MarketGraph from "./components/MarketGraph/MarketGraph"
import { indexedFrame } from "server"
import Ranking from "./components/Ranking/Ranking"

export default function App() {

  const [wallet,                 setWallet] = useState({} as wallet)
  const [currentTask,       setcurrentTask] = useState('Fetching data')
  const [transactionLog, setTransactionLog] = useState([] as string[])
  const [ranking,               setRanking] = useState([] as string[])

  useEffect(() => {
    const fetchData = async () => {
      await fetch('/data')
      .then(response => response.json())
      .then(data => {
        setWallet(data.wallet)
        setcurrentTask(data.currentTask)
        setTransactionLog(data.transactionLog)
        setRanking(data.ranking)
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
    {/* <Wallet wallet={wallet} /> */}
    <br />
    {ranking.length ? <Ranking ranking={ranking} /> : null}
    <br />
    {transactionLog.length ? <TransactionLog log={transactionLog} /> : null}
    <br />
    {
      wallet?.data?.currentMarket?.histories?.minutes
      ? <MarketGraph history={wallet.data.currentMarket.histories.minutes} />
      : null
    }
  </>
}