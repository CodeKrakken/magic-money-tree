export function formatNumber(
  number: number,
  decimals: number = 2
) {
  let outputNumber =
    parseFloat(
      number.toFixed(decimals)
    );

  if (!outputNumber) {
    outputNumber = formatNumber(
      number,
      decimals + 1
    ) as number;
  }

  return outputNumber;
}