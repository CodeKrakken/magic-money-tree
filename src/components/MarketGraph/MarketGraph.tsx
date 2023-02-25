import Chart from 'react-apexcharts';
import { indexedFrame } from 'server';
import { useEffect, useState } from 'react';

const MarketGraph = ({ history }: { history: any }) => {

  const [series, setSeries] = useState([{data:[]}])

  useEffect(() => {
    setSeries([
      {
        data: history.map((candle: indexedFrame) => ({
          x: new Date(candle.time),
          y: [candle.open, candle.high, candle.low, candle.close],
        }))
      }
    ])
  }, [history])

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

  
  return <>
    <Chart options={options} series={series} type="candlestick" height={350} />
  </>;
};

export default MarketGraph;