type logEntryType = {
  text: string,
  time: string
}

interface Log {
  general: logEntryType[];
  transactions: logEntryType[];
}

type rawFrame = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string
];


type TradingMode = 'simulation' | 'live';


export type { 
  Log,
  logEntryType,
  rawFrame,
  TradingMode
}