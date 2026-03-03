Magic Money Tree
================

A cryptocurrency autotrader
---------------------------

Leverages the Binance API for crypto trading data. Data is analysed with bespoke mathematical functions to rate markets. The app then makes decisions regarding what coin to buy and when to sell it. The app is capable of trading with a live wallet; however in the absence of a profitable trading strategy it is currently running [here](https://magic-money-tree.herokuapp.com/) with a simulated wallet.

Built with TypeScript and the good old MERN stack (Mongo, Express, React, Node). There is currently no AI involved but it is possible that including AI would be beneficial.

It has been running on Heroku without error since April 2025.

To install
----------

```
git clone https://github.com/CodeKrakken/magic-money-tree
cd magic-money-tree
npm install
cat >> .env
  MONGODB_USERNAME="your-mongo-username"
  MONGODB_PASSWORD="your-mongo-password"
  COLLECTION="local-data"
  ENVIRONMENT="local"
npm start
npm run start:server
```

There are currently no user controls.

The App is running in simulation mode. It has no access to your Binance wallet. It only requires MongoDB credentials to store the simulated wallet.
