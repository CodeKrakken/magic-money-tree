import { formatNumber, WalletType } from "@magic-money-tree/shared";

export default function WalletCoin({
  wallet,
  name
} : {
  wallet  : WalletType
  name    : string
}) {

  return <>

    <div>{formatNumber(wallet.coins[name].volume)}</div>
    <div>@</div>
    <div>{name}</div>
    <div>=</div>
    <div>{formatNumber(wallet.coins[name].dollarPrice)}</div>
    <div>${formatNumber(wallet.coins[name].dollarValue)}</div>

    {/* {`
      ${formatNumber(wallet.coins[name].volume)} 
      ${name} @ ${formatNumber(wallet.coins[name].dollarPrice)} = $
      ${formatNumber(wallet.coins[name].dollarValue)}
    `} */}
  </>
}