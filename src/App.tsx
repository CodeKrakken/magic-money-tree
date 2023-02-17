import { useEffect } from 'react';
import './App.css';
import { run } from './components/server/server';

function App() {

  useEffect(() => {
    run()
  }, [])

  return <>
    MAGIC MONEY TREE
  </>
}

export default App;
