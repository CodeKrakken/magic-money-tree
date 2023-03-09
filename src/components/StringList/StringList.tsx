import './StringList.css'
import { stringList } from 'src/App';

export default function StringList({list} : {list: stringList}) {

  return <>
    <div className="container">
      <div className="row">
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
          return <div className="row">
              {
                columns.map(col => 
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
}