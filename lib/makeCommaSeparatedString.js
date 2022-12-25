export const makeCommaSeparatedString = (arr, useOxfordComma) => {
    if (arr == null || arr.length == 0) {
        return "";
    }
    const listStart = arr.slice(0, -1).join(', ')
    const listEnd = arr.slice(-1)
    const conjunction = arr.length <= 1 
      ? '' 
      : useOxfordComma && arr.length > 2 
        ? ', and ' 
        : ' and '
  
    return [listStart, listEnd].join(conjunction)
  }