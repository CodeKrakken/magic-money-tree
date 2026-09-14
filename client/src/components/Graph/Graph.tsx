import Chart from 'react-apexcharts';
import { indexedFrame } from '../../../../server/server';
import { useEffect, useState } from 'react';

type Point = { x: Date, y: number[] }  
type Line = { data: Point[] }[]  

const Graph = ({

  history, 
  title

} : {

  history : indexedFrame[],
  title   : string

}) => {
    
  const [line, setLine] = useState<Line>([{ data: [] }])

  useEffect(() => {
    setLine([
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
    <Chart options={options} series={line} type="candlestick" height={350} />
  </>;
};

export default Graph;