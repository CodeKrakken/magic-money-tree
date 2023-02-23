export default function Text({tag, text}: {tag? : keyof JSX.IntrinsicElements, text: string}) {

  const Tag = tag || 'div'

  console.log(Tag)

  return <Tag>{text}</Tag>
}