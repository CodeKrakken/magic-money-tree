export default function StringList({
  list, 
  title,
  attrs
} : {
  list: string[], 
  title: string,
  attrs?: {
    [key: string]: {
      [key: string]: string
    }
  }
}) {
  return <>
    <h1 {...attrs?.title}>{title}</h1>
    {
      list.map(item =>
        <li {...attrs?.content}>{item}</li>
      )
    }
  </>
}