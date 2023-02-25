import Chart from 'react-apexcharts';
import { indexedFrame } from 'server';
import { useEffect } from 'react';

const MarketGraph = ({ history }: { history: any }) => {

  const options: {} = {
    chart: {
      type: 'candlestick',
      height: 350,
    },
    title: {
      text: 'Market Graph',
      align: 'left',
    },
    xaxis: {
      type: 'datetime',
    },
    yaxis: {
      tooltip: {
        enabled: true,
      },
    },
  };

  const data = history.map((candle: indexedFrame) => ({
    x: new Date(candle.time),
    y: [candle.open, candle.high, candle.low, candle.close],
  }))

  const series = [
    {
      data: data
    }
  ]



  return <>
    <Chart options={options} series={series} type="candlestick" height={350} />
  </>;
};

export default MarketGraph;