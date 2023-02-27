export {}

function roundWithoutDuplicates(inArray: Record<string, any>[], key: string) {
  const outArray: Record<string, any>[] = []

  inArray.map(inObj => {
    const outObj = { ...inObj }
    outObj[key] = round(inObj[key])
    outArray.push(outObj)
  })

  function round(inNumber: number, decimals: number=2) {
    if (!inNumber) {
      return inNumber
    }
    let outNumber = parseFloat(inNumber.toFixed(decimals))
    if ((!outNumber || outArray.some(outObj => outObj[key] === outNumber) || inArray.some(inObj => inObj[key] === outNumber)) && decimals < 100) {
      outNumber = round(inNumber, decimals+1)
    }
    return outNumber
  }

  return outArray
}

console.log(roundWithoutDuplicates([
  {ratio: 0},
  {ratio:0.999},
  {ratio:1}
], 'ratio'))
