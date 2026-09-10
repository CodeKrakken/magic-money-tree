import { useState, useEffect } from "react"
import Text from "./components/Text/Text"
import type { wallet, market } from '../../server/server'
import Wallet from "./components/Wallet/Wallet"
import CurrentTask from "./components/CurrentTask/CurrentTask"
import MarketGraph from "./components/MarketGraph/MarketGraph"
import './App.css'
import StringList from "./components/StringList/StringList"

export default function App() {

  const [wallet, setWallet] = useState({} as wallet)
  const [currentTask, setcurrentTask] = useState('Fetching data')
  const [transactions, setTransactions] = useState([] as string[])
  const [marketChart, setMarketChart] = useState([] as string[])
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
        setTransactions(data.transactions);
        setMarketChart(data.marketChart);
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
          <div style={{ marginTop: '12px', marginBottom: '12px' }}>
            <label htmlFor="live-trading-toggle" style={{ display: 'block', fontWeight: 700, marginBottom: '6px' }}>
              Live Trading
            </label>
            <label htmlFor="live-trading-toggle" style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
              <input
                id="live-trading-toggle"
                type="checkbox"
                checked={isLiveMode}
                onChange={handleModeChange}
              />
              <span>{isLiveMode ? 'LIVE TRADING' : 'SIMULATION'}</span>
            </label>
          </div>
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