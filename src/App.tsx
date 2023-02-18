import { useEffect } from 'react';
import './App.css';
import { run } from './components/server/server';

function App() {

  let running = false

  if (!running) {
    running = true
    run()
  }

  return <>
    MAGIC MONEY TREE
  </>
}

export default App;
