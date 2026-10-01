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

export type { 
  Log,
  logEntryType,
  transaction
}