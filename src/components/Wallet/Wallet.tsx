import { wallet } from 'server'

export default function Wallet({wallet}: {wallet: wallet}) {

  function getDollarTotal(wallet: wallet) {
    let total = 0
  
    Object.keys(wallet.coins).map(name => {
      total += wallet.coins[name].dollarValue
    })
  
    return total
  }

  console.log(wallet)
  return <>
    Wallet
    {
      Object.keys(wallet.coins).filter(coin => wallet.coins[coin].volume).map(name => {
        `${wallet.coins[name].volume} ${name} @ ${wallet.coins[name].dollarPrice} = $${wallet.coins[name].dollarValue}`
      })
    }
    Total = ${getDollarTotal(wallet)}
  
    {
      wallet.data.baseCoin !== 'USDT' && <>
        Target Price    - ${wallet.data.prices.targetPrice}
        High Price      - ${wallet.data.prices.highPrice}
        Purchase Price  - ${wallet.data.prices.purchasePrice}
        Stop Loss Price - ${wallet.data.prices.stopLossPrice}
      </>
    }
  </>
}