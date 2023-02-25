import { useState, useEffect } from "react"
import Log from "./components/Log/Log"
import Text from "./components/Text/Text"
import { wallet } from 'server'
import Wallet from "./components/Wallet/Wallet"
import CurrentTask from "./components/CurrentTask/CurrentTask"
import TransactionLog from "./components/TransactionLog/TransactionLog"
import MarketGraph from "./components/MarketGraph/MarketGraph"

export default function App() {

  const [wallet,                 setWallet] = useState({} as wallet)
  const [currentTask,       setcurrentTask] = useState('Fetching data')
  const [transactionLog, setTransactionLog] = useState([] as string[])
  const [history,               setHistory] = useState({})
  const [markets,               setMarkets] = useState([])

  useEffect(() => {
    const fetchData = async () => {
      await fetch('/data')
      .then(response => response.json())
      .then(data => {
        setWallet(data.wallet)
        setcurrentTask(data.currentTask)
        setTransactionLog(data.transactionLog)
        setHistory(data.history)
        setMarkets(data.markets)
        console.log(markets)
      })
    }
    
    fetchData();
    const intervalId = setInterval(fetchData, 1000);
  
    return () => clearInterval(intervalId);
  }, []);

  return <>
    <Text text='Magic Money Tree' tag='h1' />
    <CurrentTask currentTask={currentTask} />
    <Wallet wallet={wallet} />
    <br />
    <TransactionLog log={transactionLog} />

    {
      wallet.data.baseCoin !== 'USDT' && <MarketGraph history={history} />
    }
  </>
}