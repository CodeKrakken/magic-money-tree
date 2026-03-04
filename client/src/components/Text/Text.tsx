import './Text.css'

export default function Text(
  {
    tag, 
    text, 
    attrs
  } : {
    tag?  : keyof JSX.IntrinsicElements, 
    text  : string, 
    attrs?: {[key: string]: string}
  }
) {

  const Tag = tag || 'div'

  return <Tag {...attrs}>{text}</Tag>
}