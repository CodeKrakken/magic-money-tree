export default function TransactionLog({log}: {log: string[]}) {
  return <>
    <h1>Transactions</h1>
    {
      log.map(transaction =>
        <div>{transaction}</div>
      )
    }
  </>
}