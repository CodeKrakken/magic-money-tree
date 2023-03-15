import './StringList.css'
import { stringList } from 'src/App';

export default function StringList({list} : {list: stringList}) {

  return <>
    <div style={{height: '200px', overflow: 'auto'}}>
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
        })
      }
    </div>
    {/* <div className="col-container">
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
    </div> */}
  </>
}