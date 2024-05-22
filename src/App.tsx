import { useState, useEffect } from "react"
import Text from "./components/Text/Text"
import { wallet, market } from 'server'
import Wallet from "./components/Wallet/Wallet"
import CurrentTask from "./components/CurrentTask/CurrentTask"
import MarketGraph from "./components/MarketGraph/MarketGraph"
import './App.css'
import StringList from "./components/StringList/StringList"



export interface stringList {
  lines: stringListItem[]
  headers: string[]
}

export interface stringListItem {
  time?: string
  text: (string|number)[]
}

export default function App() {

  const [wallet,                 setWallet] = useState({} as wallet)
  const [currentTask,       setcurrentTask] = useState('Fetching data')
  const [transactions,     setTransactions] = useState({} as stringList)
  const [marketChart,       setMarketChart] = useState({} as stringList)
  const [currentMarket,   setCurrentMarket] = useState({} as market)

  useEffect(() => {

    const fetchData = async () => {
      // const data = await fetch('/data')                       //  heroku
      const data = await fetch('http://localhost:5000/data')  //  local
      .then(response => response.json())
      .then(data => {
        setWallet(data.wallet)
        setcurrentTask(data.currentTask)
        setTransactions(data.transactions)
        setMarketChart(data.marketChart)
        setCurrentMarket(data.currentMarket)
      })
    }
    
    fetchData();
    
    const intervalId = setInterval(fetchData, 200);
  
    return () => clearInterval(intervalId);
  }, []);

  console.log(currentTask)  
  
  return <>
    <div className="container">
      <div className="row flex-no-grow">
        <div className="col center header">
          <Text text='MARKETS' tag='h1' />
        </div>
        <div className="col center header">
          <Text text='MAGIC MONEY TREE' tag='h1' attrs={{className: 'title'}} />
        </div>
        <div className="col center header">
          <Text text='TRANSACTIONS' tag='h1' />
        </div>
      </div>
      <div className="row flex-grow">
        <div className="col center">
          {
            marketChart?.lines?.length ? (
              <StringList 
                list={marketChart} 
              />
            ) : null
          }
        </div>
        <div className="col center">
          <CurrentTask currentTask={currentTask} />
          <br />
          <Wallet wallet={wallet} />
        </div>
        <div className="col center">
          {
            transactions?.lines?.length ? (
              <StringList 
                list={transactions} 
              />
            ) : null
          }
        </div>
      </div>
      <div className="row flex-no-grow">
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