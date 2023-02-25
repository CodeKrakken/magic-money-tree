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

  const series = [
    {
      x: new Date('2022-01-01'),
      y: [500, 550, 450, 510],
      open: 500,
      high: 550,
      low: 450,
      close: 510,
    },
    {
      x: new Date('2022-01-02'),
      y: [510, 560, 490, 520],
      open: 510,
      high: 560,
      low: 490,
      close: 520,
    },
    // ...
  ];

  return (
    <Chart options={options} series={series} type="candlestick" height={350} />
  );
};

export default MarketGraph;