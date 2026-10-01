import { Log, logEntryType, transaction } from "../shared.types";
import { writeFile } from 'fs/promises';
import { state } from "../state";

const {  
  log
} = state

export function logEntry(
  entry : logEntryType,
  topic : string = 'general'
) {
  console.log(
    isTransaction(entry)
      ? `${(entry).time}  |  ${entry.text}`
      : entry
  );

  log[topic] = log[topic] ?? [];
  log[topic]?.push(entry);
}

function isTransaction(
  entry: logEntryType
): entry is transaction {
  return (entry as transaction).time !== undefined;
}

async function writeToFile(fileName: any, data: any) {
  try {
    await writeFile(fileName, data);
    console.log(`Wrote data to ${fileName}`);
  } catch (error: any) {
    console.error(
      `Got an error trying to write the file: ${error.message}`
    );
  }
}