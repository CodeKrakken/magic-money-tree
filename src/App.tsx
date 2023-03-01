import { useState, useEffect } from "react"
import Text from "./components/Text/Text"
import { wallet, market } from 'server'
import Wallet from "./components/Wallet/Wallet"
import CurrentTask from "./components/CurrentTask/CurrentTask"
import MarketGraph from "./components/MarketGraph/MarketGraph"
import './App.css'
import StringList from "./components/StringList/StringList"

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
          {ranking.length ? <StringList list={ranking} title='Chart' /> : null}
        </div>
        <div className="col center">
          <Text text='Magic Money Tree' tag='h1' attrs={{className: 'title'}} />
          <CurrentTask currentTask={currentTask} />
          <br />
          <Wallet wallet={wallet} />
        </div>
        <div className="col">
          {transactionLog.length ? <StringList list={transactionLog} title='Transactions' /> : null}
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