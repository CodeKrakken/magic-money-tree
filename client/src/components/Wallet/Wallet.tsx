import { WalletType } from '@magic-money-tree/shared/types'
import { formatNumber } from '@magic-money-tree/shared/functions'

export default function Wallet({
  wallet
}: {
  wallet: WalletType
}) {

  function getDollarTotal(wallet: WalletType) {
    let total = 0
  
    Object.keys(wallet.coins).map(name => {
      total += wallet.coins[name].dollarValue
    })
  
    return total
  }

  return wallet?.coins ? <>
    <h1>Wallet</h1>
    {
      Object.keys(wallet.coins).filter(coin => wallet.coins[coin].volume).map(name => 
        <>
          {
            `${formatNumber(wallet.coins[name].volume)} ${name} @ ${formatNumber(wallet.coins[name].dollarPrice)} = $${formatNumber(wallet.coins[name].dollarValue)}`
          }
          <br />
        </>
      ) 
    }
    
    <div>Total = ${formatNumber(getDollarTotal(wallet))}</div>
  
  </> : <>No wallet data</>
}