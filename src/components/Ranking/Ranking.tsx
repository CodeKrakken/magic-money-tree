export default function Ranking({ranking}: {ranking:string[]}) {
  return <>
    <h2>Ranking</h2>
    {
      ranking.map(rank => 
        <div>{rank}</div>
      )
    }
  </>
}