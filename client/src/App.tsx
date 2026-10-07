import { useState, useEffect } from "react"
import ColumnHeader from "./components/ColumnHeader/ColumnHeader"
import type { WalletType, PortfolioSnapshot } from '@magic-money-tree/shared'
import Wallet from "./components/Wallet/Wallet"
import CurrentTask from "./components/CurrentTask/CurrentTask"
import MarketChart from "./components/MarketChart/MarketChart"
import './App.css'
import StringList from "./components/StringList/StringList"

export default function App() {

  const [wallet, setWallet] = useState({} as WalletType)
  const [currentTask, setcurrentTask] = useState('Fetching data')
  const [transactions, setTransactions] = useState([] as string[])
  const [markets, setMarketChart] = useState([] as string[])
  const [tradingMode, setTradingMode] = useState<'simulation' | 'live'>('simulation')
  const [portfolioHistory, setPortfolioHistory] = useState([] as PortfolioSnapshot[])


  useEffect(() => {
    
    let cancelled = false; // stop async fetch updating state after component unmounts

    const fetchTradingMode = async () => {
      try {

        const response = await fetch('/api/trading-mode', {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-store' }
        });

        if (!response.ok) {
          return;
        }

        const data = await response.json();

        if (!cancelled && data?.tradingMode) {
          setTradingMode(data.tradingMode);
        }

      } catch (error) {
        console.error('[App] Error fetching trading mode:', error);
      }
    };

    const fetchData = async () => {
      try {

        const url = `/data?t=${Date.now()}`;

        const response = await fetch(url, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-store' }
        });

        if (!response.ok || cancelled) return;
        
        const data = await response.json();

        setWallet(data.wallet);
        setcurrentTask(data.currentTask);
        setTransactions(data.transactions.reverse());
        setMarketChart(data.markets);

        if (data.tradingMode) setTradingMode(data.tradingMode);

      } catch (error) {
        console.error('[App] Error fetching data:', error);
      }

      if (!cancelled) setTimeout(fetchData, 1000);
    };

    const fetchPortfolioHistory = async () => {
      try {

        const response = await fetch('/api/portfolio-history', {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-store' }
        });

        if (!response.ok) return;

        const data = await response.json();

        if (!cancelled) setPortfolioHistory(data);

      } catch (error) {
        console.error('[App] Error fetching trading mode:', error);
      }
    };

    fetchTradingMode();
    fetchData();
    fetchPortfolioHistory();

    return () => {
      cancelled = true;
    };

  }, []);

  const isLiveMode = tradingMode === 'live';

  const handleModeChange = async () => {

    const nextMode = isLiveMode ? 'simulation' : 'live';

    if (nextMode === 'live') {
      const confirmed = window.confirm('Enable live trading? Real Binance orders may be placed.');
      if (!confirmed) return;
    }

    const response = await fetch('/api/trading-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        mode: nextMode, 
        confirm: nextMode === 'live' 
      })
    });

    const data = await response.json();

    if (response.ok && data?.tradingMode) {
      setTradingMode(data.tradingMode);
      return;
    }

    if (data?.error) window.alert(data.error);
  };

  return <>
    <div id="app">

      <div className="row flex-no-grow">
        <ColumnHeader text='Markets' tag='h1' />
        <ColumnHeader text='Magic Money Tree' tag='h1' attrs={{className: 'title'}} />
        <ColumnHeader text='Transactions' tag='h1' />
      </div>

      <div className="row flex-grow">

        <div className="col center">
          {
            markets.length ? (
              <StringList 
                list={markets} 
              />
            ) : null
          }
        </div>

        <div className="col center">
          <CurrentTask currentTask={currentTask} />
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
          <MarketChart 
            title={'Your Money, baby'} 
            history={portfolioHistory} 
          />
        </div>

      </div>
    </div>
  </>
}