import Chart from 'react-apexcharts';

const MarketGraph = ({ history }: { history: any }) => {

  console.log('hello')
  console.log(history)
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
      data: history,
    },
  ];

  return (
    <Chart options={options} series={series} type="candlestick" height={350} />
  );
};

export default MarketGraph;