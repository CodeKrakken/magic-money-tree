import Chart from 'react-apexcharts';
import { PortfolioSnapshot } from '../../../../shared';
import { useEffect, useState } from 'react';

type Point = { x: Date, y: number[] }  
type Line = { data: Point[] }[]  

const MarketChart = ({

  history, 
  title,

} : {

  history : PortfolioSnapshot[],
  title   : string

}) => {

    
  const [line, setLine] = useState<Line>([{ data: [] }])

  // useEffect(() => {
  //   setLine([
  //     {
  //       data: history.map((frame: PortfolioSnapshot) => ({
  //         x: new Date(frame.time),
  //         y: [frame.open, frame.high, frame.low, frame.close],
  //       }))
  //     }
  //   ])
  // }, [history])

  const assets = [
    ...new Set(
      history.flatMap(snapshot =>
        Object.keys(snapshot.values)
      )
    )
  ];

  

  const series = [
    ...assets.map(asset => ({
      name: asset,
      data: history.map(snapshot => [
        snapshot.timestamp,
        snapshot.values[asset] ?? 0
      ])
    })),
    {
      name: 'Total',
      data: history.map(snapshot => [
        snapshot.timestamp,
        snapshot.total
      ])
    }
  ];

  const options: {} = {
    chart: {
      type: 'line',
      animations: {
        enabled: false
      }
    },
    stroke: {
      curve: 'straight',
      width: 2
    },
    xaxis: {
      type: 'datetime'
    },
    yaxis: {
      labels: {
        formatter: (value: number) => `$${value.toFixed(2)}`
      }
    }
  };

  
  return <>
    <Chart 
      options = {options} 
      series  = {series} 
      type    = "line" 
      height  = {350} 
    />
  </>;
};

export default MarketChart;