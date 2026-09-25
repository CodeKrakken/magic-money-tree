import React from 'react'
import './ColumnHeader.css'

export default function ColumnHeader({ 
  text,
  attrs
} : {
  text  : string  
  attrs? : {}
}) {
  return (
    <div className="col center">
      <h1 {...attrs}>{text}</h1>
    </div>
  )
}