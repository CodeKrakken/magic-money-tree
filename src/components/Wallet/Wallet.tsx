import { wallet } from 'server'

export default function Wallet({wallet}: {wallet: wallet}) {

  function round(number: number, decimals: number=2) {
    let outputNumber = parseFloat(number.toFixed(decimals))
    if (!outputNumber && decimals < 100) {outputNumber = round(number, decimals+1) as number}
    return outputNumber
  }

  function getDollarTotal(wallet: wallet) {
    let total = 0
  
    Object.keys(wallet.coins).map(name => {
      total += wallet.coins[name].dollarValue
    })
  
    return total
  }

  return wallet?.coins ? <>
    <h1>WALLET</h1>

    {
      Object.keys(wallet.coins).filter(coin => wallet.coins[coin].volume).map(name => 
        <div>
          {round(wallet.coins[name].volume)} {name} @ {round(wallet.coins[name].dollarPrice)} = ${round(wallet.coins[name].dollarValue)}
        </div>
      )
    }

    <div>Total = ${round(getDollarTotal(wallet))}</div>
  
    {/* {
      wallet.data.baseCoin !== 'USDT' && <>
        Target Price    - ${wallet.data.prices.targetPrice}   <br />
        High Price      - ${wallet.data.prices.highPrice}     <br />
        Purchase Price  - ${wallet.data.prices.purchasePrice} <br />
        Stop Loss Price - ${wallet.data.prices.stopLossPrice}
      </>
    } */}
  </> : <>No wallet data</>
}