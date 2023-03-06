import './StringList.css'

type transaction = {
  text: string,
  time: string
}

export default function StringList({list} : {list: string[]|transaction[]}) {

  function isTransaction(entry: string|transaction): entry is transaction {
    return (entry as transaction).time !== undefined;
  }

  return <ul>
    {
      list.map(item => {
        return isTransaction(item)
        ? <li title={item.time}>${item.text}</li>
        : <li>{item}</li>
      })
    }
  </ul>
}