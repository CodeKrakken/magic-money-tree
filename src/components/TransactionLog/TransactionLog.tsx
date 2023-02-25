export default function TransactionLog({log}: {log: string[]}) {
  return <>
    <h2>Transactions</h2>
    {
      log.map(transaction =>
        <div>{transaction}</div>
      )
    }
  </>
}