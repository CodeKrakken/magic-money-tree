import { useState, useEffect } from "react"

export default function App() {

  interface item {
    id  : number,
    name: string
  }
  const [log, setLog] = useState([] as string[])

  useEffect(() => {
    fetch('http://localhost:5000/api/log')
    .then(response => response.json())
    .then(data => setLog(data))

  }, [])

  return <>
    <div>
      {log && (
        <ul>
          {log.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  </>
}