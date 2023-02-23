import { useState, useEffect } from "react"

export default function App() {

  interface item {
    id  : number,
    name: string
  }
  const [log, setLog] = useState([] as string[])

  useEffect(() => {
    const fetchLog = async () => {
      fetch('http://localhost:5000/api/log')
      .then(response => response.json())
      .then(data => setLog(data))
    }
    
    fetchLog()

    const intervalId = setInterval(() => {
      fetchLog()
    }, 1000)

    return () => clearInterval(intervalId)

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