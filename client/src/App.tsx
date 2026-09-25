import { useState, useEffect } from "react"
import Text from "./components/ColumnHeader/ColumnHeader"
import type { WalletType, market } from '@magic-money-tree/shared'
import Wallet from "./components/Wallet/Wallet"
import CurrentTask from "./components/CurrentTask/CurrentTask"
import MarketChart from "./components/MarketChart/MarketChart"
import './App.css'
import StringList from "./components/StringList/StringList"
import ColumnHeader from "./components/ColumnHeader/ColumnHeader"

export default function App() {

  const [wallet, setWallet] = useState({} as WalletType)
  const [currentTask, setcurrentTask] = useState('Fetching data')
  const [transactions, setTransactions] = useState([] as string[])
  const [markets, setMarkets] = useState([] as string[])
  const [currentMarket, setCurrentMarket] = useState({} as market)
  const [tradingMode, setTradingMode] = useState<'simulation' | 'test' | 'live'>('simulation')

  useEffect(() => {
    let cancelled = false;

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
        if (!response.ok) {
          return;
        }
        if (cancelled) return;
        const data = await response.json();
        setWallet(data.wallet);
        setcurrentTask(data.currentTask);
        setTransactions(data.transactions.reverse());
        setMarkets(data.markets);
        setCurrentMarket(data.currentMarket);
        if (data.tradingMode) {
          setTradingMode(data.tradingMode);
        }
      } catch (error) {
        console.error('[App] Error fetching data:', error);
      }
      if (!cancelled) setTimeout(fetchData, 1000);
    };

    fetchTradingMode();
    fetchData();

    return () => {
      cancelled = true;
    };
  }, []);

  const isLiveMode = tradingMode === 'live';

  const handleModeChange = async () => {
    const nextMode = isLiveMode ? 'simulation' : 'live';

    if (nextMode === 'live') {
      const confirmed = window.confirm('Enable live trading? Real Binance orders may be placed.');
      if (!confirmed) {
        return;
      }
    }

    const response = await fetch('/api/trading-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: nextMode, confirm: nextMode === 'live' })
    });

    const data = await response.json();
    if (response.ok && data?.tradingMode) {
      setTradingMode(data.tradingMode);
      return;
    }

    if (data?.error) {
      window.alert(data.error);
    }
  };

  return <>
    <div id="app-container">
      <div className="row flex-no-grow">
        <div className="col center">
          <ColumnHeader text='Markets' />
          {
            markets.length ? (
              <StringList 
                list={markets} 
              />
            ) : null
          }
        </div>

        <div className="col center">
          <ColumnHeader text='Magic Money Tree' attrs={{className: 'title'}} />
          <CurrentTask currentTask={currentTask} />      
          <Wallet wallet={wallet} />
        </div>
        
        <div className="col center">
          <ColumnHeader text='Transactions' />
          {
            transactions.length ? (
              <StringList 
                list={transactions} 
              />
            ) : null
          }
        </div>
      
        <div className="row flex-no-grow">
          <div className="full-width">
            {
              currentMarket?.histories?.minutes
              ? <MarketChart title={currentMarket.name} history={currentMarket.histories.minutes} />
              : null
            }
          </div>
        </div>
      </div>
    </div>
  </>
}