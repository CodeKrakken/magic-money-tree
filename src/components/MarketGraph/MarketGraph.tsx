import Chart from 'react-apexcharts';
import { indexedFrame } from 'server';
import { useEffect, useState } from 'react';

const MarketGraph = ({ history, title }: { history: any, title: string }) => {

  const [series, setSeries] = useState([{data:[]}])

  useEffect(() => {
    setSeries([
      {
        data: history.map((frame: indexedFrame) => ({
          x: new Date(frame.time),
          y: [frame.open, frame.high, frame.low, frame.close],
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
      text: title,
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