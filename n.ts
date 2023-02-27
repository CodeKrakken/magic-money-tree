export {}

function n(number: number, decimals: number=2) {

  let outputNumber = parseFloat(number.toFixed(decimals))

  if (!outputNumber) {
    outputNumber = n(number, decimals+1) as number
  }
  return outputNumber
}

console.log(n(0.00001))