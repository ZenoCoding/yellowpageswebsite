import { parseISO, format, isValid } from 'date-fns'

export default function Date({ dateString }) {
  const date = parseISO(dateString)
  if (!isValid(date)) {
    return <p>Invalid date</p>
  }
  return <time dateTime={dateString}>{format(date, 'LLLL d, yyyy')}</time>
}