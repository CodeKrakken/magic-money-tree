import { WalletType } from '@magic-money-tree/shared'
import { formatNumber } from '@magic-money-tree/shared'
import '../../App.css'
import WalletCoin from '../WalletCoin/WalletCoin'

export default function Wallet({
  wallet
}: {
  wallet: WalletType
}) {

  function getDollarTotal(wallet: WalletType) {
    let total = 0
  
    Object.keys(wallet.coins).forEach(name => {
      total += wallet.coins[name].dollarValue
    })
  
    return total
  }

  return wallet?.coins ? (
    <div id="wallet">
      <h1>
        Wallet    
      </h1>

      <div>
        ${formatNumber(getDollarTotal(wallet))}
      </div>
      
      <div id="coin-list">
        {
          Object.keys(wallet.coins).filter(coin => wallet.coins[coin].volume).map(name => 
            <WalletCoin
              wallet  = {wallet}
              name    = {name}
            />
          ) 
        }
      </div>
    </div>
  ) : <>No wallet data</>
}