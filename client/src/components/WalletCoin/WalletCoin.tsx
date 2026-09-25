import { formatNumber, WalletType } from "@magic-money-tree/shared";

export default function WalletCoin({
  wallet,
  name
} : {
  wallet  : WalletType
  name    : string
}) {

  return <>
    <div className="row">
      <div className="cell">{formatNumber(wallet.coins[name].volume)}</div>
      <div className="cell">{name}</div>
      <div className="cell">{formatNumber(wallet.coins[name].dollarPrice)}</div>
      <div className="cell">${formatNumber(wallet.coins[name].dollarValue)}</div>
    </div>
  </>
}