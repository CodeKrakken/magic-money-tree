import React from 'react'
import './Text.css'

interface TextProps {
  tag?: keyof React.JSX.IntrinsicElements
  text: string
  attrs?: { [key: string]: string }
}

export default function Text({ tag = 'div', text, attrs }: TextProps) {
  return React.createElement(tag as string, attrs, text)
}