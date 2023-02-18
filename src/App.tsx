import { useEffect } from 'react';
import './App.css';
import { run } from './components/server/server';

let running = false


function App() {


  if (!running) {
    running = true
    run()
  }

  return <>
    MAGIC MONEY TREE
  </>
}

export default App;
