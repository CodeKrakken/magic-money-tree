import './StringList.css'
import { stringList } from 'src/App';

<<<<<<< HEAD
export default function StringList({list} : {list: stringList}) {

  return <>
    <div className="col-container">
      <div className="col-row">
        {
          list?.headers?.map(item => 
            <div className="col">
              {item}
            </div>
          )
        }
      </div>
      {
        list?.lines?.map(line => {
          console.log(line)
          const columns = line.text
          return <div className="col-row" {...(line.time && { title: line.time })}>
              {
                columns?.map(col => 
                  <div className="col">
                    {col}
                  </div>
                )
              }
            </div>
          }
        )
      }
    </div>
  </>
=======
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
        ? <li title={item.time}>{item.text}</li>
        : <li>{item}</li>
      })
    }
  </ul>
>>>>>>> local
}