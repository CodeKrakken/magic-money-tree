import React from 'react'
import './Text.css'

export default function Text({ 

  text, 
  attrs,
  tag = 'div'

} : {

  text    : string
  tag?    : keyof React.JSX.IntrinsicElements
  attrs?  : { [key: string]: string }
  
}) {
  return React.createElement(tag as string, attrs, text)
}