import { useEffect } from 'react';
import './App.css';
import { run } from './components/server/server';

useEffect(() => {
  run()
}, [])

function App() {

  return <>
    MAGIC MONEY TREE
  </>
}

export default App;
