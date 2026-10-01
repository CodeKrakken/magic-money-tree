type transaction = {
  text: string,
  time: string
}

type logEntryType = string | transaction;

interface Log {
  general: string[];
  transactions: transaction[];
  [key: string]: logEntryType[] | undefined;
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

export type { 
  Log,
  logEntryType,
  transaction,
  rawFrame
}