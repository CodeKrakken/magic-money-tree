import React from 'react'
import './ColumnHeader.css'

export default function ColumnHeader({ 

  text, 
  attrs,
  tag = 'div'

} : {

  text    : string
  tag?    : keyof React.JSX.IntrinsicElements
  attrs?  : { [key: string]: string }
  
}) {
  return (
    <div className="col center">
      {React.createElement(tag as string, attrs, text)}
    </div>
  )
}