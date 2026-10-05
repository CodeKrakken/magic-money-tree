import { writeFile } from 'fs/promises';
import { state } from "../state.js";
import { timeNow } from "../shared.functions.js";

export function logEntry(
  entry : string,
  topic : ('general' | 'transactions') = 'general'
) {

  console.log(`${timeNow()}  |  ${entry}`);

  state.log[topic] = state.log[topic] ?? [];
  state.log[topic]?.push({
    text: entry,
    time: timeNow()
  });
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