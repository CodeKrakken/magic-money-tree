export default function StringList({list, title}: {list: string[], title: string}) {
  return <>
    <h1>{title}</h1>
    {
      list.map(item =>
        <li>{item}</li>
      )
    }
  </>
}