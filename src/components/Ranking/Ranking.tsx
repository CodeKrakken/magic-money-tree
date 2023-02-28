export default function Ranking({ranking}: {ranking:string[]}) {
  return <>
    <h1>Ranking</h1>
    {
      ranking.map(rank => 
        <div>{rank}</div>
      )
    }
  </>
}