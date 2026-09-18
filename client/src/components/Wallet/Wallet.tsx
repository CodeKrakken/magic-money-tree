import { WalletType } from '../../../../server/server'

export default function Wallet({
  wallet
}: {
  wallet: WalletType
}) {

  function formatNumber(number: number, decimals: number=2) {
    let outputNumber = parseFloat(number.toFixed(decimals))
    if (!outputNumber && decimals < 100) {outputNumber = formatNumber(number, decimals+1) as number}
    return outputNumber
  }

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