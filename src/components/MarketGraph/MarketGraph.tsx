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

  let series

  useEffect(() => {
    series = [
      {
        data: history.map((candle: indexedFrame) => [
          candle.time,
          candle.open,
          candle.high,
          candle.low,
          candle.close,
        ]),
      },
    ];
  }, [history])

  return (
    <Chart options={options} series={series} type="candlestick" height={350} />
  );
};

export default MarketGraph;