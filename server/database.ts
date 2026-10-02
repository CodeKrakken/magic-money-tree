import { MongoClient, ServerApiVersion } from 'mongodb';
import { collectionName, dbName, password, username } from './config.js';
import { formatNumber, WalletType } from '@magic-money-tree/shared';
import { Log } from './shared.types.js';
import { simulatedWallet } from './shared.functions.js';

const uri =
  `mongodb+srv://${username}:${password}@magic-money-tree.ohcuy3y.mongodb.net/?retryWrites=true&w=majority`;

const mongo = new MongoClient(
  uri,
  {
    serverApi: ServerApiVersion.v1
  }
);

let database;

let collection: any;

// Types

interface collection {
  [key: string]: any
}

export async function setUpDB() {
  console.log('Awaiting Mongo Connect')
  await mongo.connect();
  console.log(`Database is going to be mongo db ${dbName}`)
  database = mongo.db(dbName);
  console.log(database)
  console.log(`Collection is going to be database collection ${collectionName}`)
  collection = database.collection(collectionName);
  console.log(collection)

  const count = await collection.countDocuments();

  if (count === 0) {

    await collection.insertOne({
      data: {}
    });
  } 
}


export async function pullFromDatabase(
  wallet: WalletType, 
  log: Log, 
  viableSymbols: string[]
) {

  const data = await collection.findOne({});

  if (data?.data?.wallet) {
    wallet = migrateWallet(data.data.wallet);
  }

  if (data?.data?.log) {
    log = data.data.log;
  }

  if (data?.data?.viableSymbols) {
    viableSymbols = data.data.viableSymbols;
  }

}

function migrateWallet(savedWallet: WalletType): WalletType {
  if (
    savedWallet?.data?.positions &&
    Array.isArray(savedWallet.data.positions)
  ) {
    return savedWallet;
  }

  console.log(
    'Existing wallet uses the old single-position structure. Starting the new portfolio with $100.'
  );

  return simulatedWallet();
}

export async function saveState(
  wallet: WalletType,
  log: Log,
  viableSymbols: string[]
) {
  await collection.replaceOne(
    {},
    {
      data: {
        wallet: wallet,
        log: log,
        viableSymbols: viableSymbols
      }
    }
  );
}
