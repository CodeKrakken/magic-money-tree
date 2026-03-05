import { useState, useEffect } from "react"
import Text from "./components/Text/Text"
import type { wallet, market } from '../../server/server'
import Wallet from "./components/Wallet/Wallet"
import CurrentTask from "./components/CurrentTask/CurrentTask"
import MarketGraph from "./components/MarketGraph/MarketGraph"
import './App.css'
import StringList from "./components/StringList/StringList"
// environment is handled via proxy in development; no need for react-dotenv here

export default function App() {

  const [wallet,                 setWallet] = useState({} as wallet)
  const [currentTask,       setcurrentTask] = useState('Fetching data')
  const [transactions,     setTransactions] = useState([] as string[])
  const [marketChart,               setMarketChart] = useState([] as string[])
  const [currentMarket,   setCurrentMarket] = useState({} as market)
  const [log, setLog] = useState([] as string[])


  useEffect(() => {
    console.log('[App] useEffect mounted');
    let cancelled = false;

    const fetchData = async () => {
      console.log('[App] fetchData start');
      try {
        // rely on the development proxy to forward `/data` to the backend
        const url = `/data?t=${Date.now()}`;
        console.log('[App] hitting URL', url);
        const response = await fetch(url, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-store' }
        });
        if (!response.ok) {
          console.error('[App] response error', response.status, response.statusText);
          return;
        }
        if (cancelled) return;
        const data = await response.json();
        console.log('[App] received data.currentTask:', data.currentTask);
        setWallet(data.wallet);
        setcurrentTask(data.currentTask);
        setTransactions(data.transactions);
        setMarketChart(data.marketChart);
        setCurrentMarket(data.currentMarket);
      } catch (error) {
        console.error('[App] Error fetching data:', error);
      }
      if (!cancelled) setTimeout(fetchData, 1000);
    };

    fetchData();

    return () => {
      console.log('[App] useEffect cleanup');
      cancelled = true;
    };
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