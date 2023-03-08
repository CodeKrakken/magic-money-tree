function getTrendScore(array: number[]) {

  let outArray = Array.from(array)

  while (outArray.length > 1) {
    console.log(outArray)
    outArray = getDifferenceArray(outArray)
    console.log(outArray)

    outArray = getRatioArray(outArray)
  }


  const score = outArray[0]

  return score
}

function getDifferenceArray(array: number[]) {
  const outArray: number[] = []
  for (let i = 1; i < array.length; i++) {
    outArray.push(array[i] - array[i-1])
  }
  return outArray
}

function getRatioArray(valueArray: number[]) {

  const ratioArray: number[] = []
  for (let i = 0; i < valueArray.length-1; i++) {
    ratioArray.push(valueArray[i+1]/valueArray[i])
  }
  return ratioArray
}

console.log(getTrendScore([0.98, 0.99, 1, 1.01, 1.02]))

export {}