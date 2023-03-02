import './StringList.css'

export default function StringList({
  list, 
  attrs
} : {
  list: string[], 

  attrs?: {
    [key: string]: {
      [key: string]: string
    }
  }
}) {
  return <ul>
    {
      list.map(item =>
        <li {...attrs?.content}>{item}</li>
      )
    }
  </ul>
}