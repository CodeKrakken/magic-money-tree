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
  const [transactions,     setTransactions] = useState([] as string[])
  const [marketChart,               setMarketChart] = useState([] as string[])
  const [currentMarket,   setCurrentMarket] = useState({} as market)
  const [log, setLog] = useState([] as string[])

  useEffect(() => {

    const fetchData = async () => {
      const data = await fetch('/data')                       //  heroku
      // const data = await fetch('http://localhost:5000/data')  //  local
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

  return <>
    <div className="container">
      <div className="row flex-no-grow">
        <div className="col center">
          <Text text='Markets' tag='h1' />
        </div>
        <div className="col center">
          <Text text='Magic Money Tree' tag='h1' attrs={{className: 'title'}} />
        </div>
        <div className="col center">
          <Text text='Transactions' tag='h1' />
        </div>
      </div>
      <div className="row flex-grow">
        <div className="col center">
          {
            marketChart.length ? (
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
            transactions.length ? (
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