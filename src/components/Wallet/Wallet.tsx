import { wallet } from 'server'

export default function Wallet({wallet}: {wallet: wallet}) {

  function getDollarTotal(wallet: wallet) {
    let total = 0
  
    Object.keys(wallet.coins).map(name => {
      total += wallet.coins[name].dollarValue
    })
  
    return total
  }

  return wallet?.coins ? <>
    <h2>Wallet</h2>

    {
      Object.keys(wallet.coins).filter(coin => wallet.coins[coin].volume).map(name => 
        `${wallet.coins[name].volume} ${name} @ ${wallet.coins[name].dollarPrice} = $${wallet.coins[name].dollarValue}`
      )
    }

    <div>Total = ${getDollarTotal(wallet)}</div>
  
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