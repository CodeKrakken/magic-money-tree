import { useState, useEffect } from "react"
import Log from "./components/Log/Log"
import Text from "./components/Text/Text"
import { wallet, market } from 'server'
import Wallet from "./components/Wallet/Wallet"
import CurrentTask from "./components/CurrentTask/CurrentTask"
import TransactionLog from "./components/TransactionLog/TransactionLog"
import MarketGraph from "./components/MarketGraph/MarketGraph"
import { indexedFrame } from "server"
import Ranking from "./components/Ranking/Ranking"
import './App.css'

export default function App() {

  const [wallet,                 setWallet] = useState({} as wallet)
  const [currentTask,       setcurrentTask] = useState('Fetching data')
  const [transactionLog, setTransactionLog] = useState([] as string[])
  const [ranking,               setRanking] = useState([] as string[])
  const [currentMarket,   setCurrentMarket] = useState({} as market)

  useEffect(() => {
    const fetchData = async () => {
      await fetch('/data')
      .then(response => response.json())
      .then(data => {
        setWallet(data.wallet)
        setcurrentTask(data.currentTask)
        setTransactionLog(data.transactionLog)
        setRanking(data.ranking)
        setCurrentMarket(data.currentMarket)
      })
    }
    
    fetchData();
    const intervalId = setInterval(fetchData, 200);
  
    return () => clearInterval(intervalId);
  }, []);

  console.log(wallet)

  return <>
    <div className="container">
      <div className="row">
        <div className="col">
          {ranking.length ? <Ranking ranking={ranking} /> : null}
        </div>
        <div className="col center">
          <Text text='Magic Money Tree' tag='h1' attrs={{className: 'title'}} />
          <CurrentTask currentTask={currentTask} />
          <br />
          <Wallet wallet={wallet} />
        </div>
        <div className="col">
          {transactionLog.length ? <TransactionLog log={transactionLog} /> : null}
        </div>
      </div>
      <div className="row">
        <div className="full-width">
          {
            currentMarket?.histories?.minutes
            ? <MarketGraph title={currentMarket.name} history={currentMarket.histories.minutes} />
            : null
          }
        </div>
      </div>
    </div>
  </>
}