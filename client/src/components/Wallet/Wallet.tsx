import { WalletType } from '@magic-money-tree/shared'
import { formatNumber } from '@magic-money-tree/shared'
import '../../App.css'

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
      
      {
        Object.keys(wallet.coins).filter(coin => wallet.coins[coin].volume).map(name => 
          <div className="centred row">
            <div className="cell">{formatNumber(wallet.coins[name].volume)}</div>
            <div className="cell">{name}</div>
            <div className="cell">{formatNumber(wallet.coins[name].dollarPrice)}</div>
            <div className="cell">{formatNumber(wallet.coins[name].dollarValue)}</div>
          </div>
        ) 
      }
      
      
    
    </div>
  ) : <>No wallet data</>
}