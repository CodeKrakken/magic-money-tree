import { useRef, useEffect, useState } from 'react';

interface LogProps {
  
}

const Log = (
  log: string[]
) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldScrollToBottom, setShouldScrollToBottom] = useState(true);

  useEffect(() => {
    if (containerRef.current) {
      if (shouldScrollToBottom) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
    }
  }, [log, shouldScrollToBottom]);

  function handleScroll() {
    if (containerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
      const isAtBottom = scrollHeight - scrollTop === clientHeight;
      setShouldScrollToBottom(isAtBottom);
    }
  }

  return (
    <div 
      style={{
        height: '60vh',
        overflowY: 'scroll'
      }} 
      ref={containerRef} onScroll={handleScroll}
    >
      {
        log.map((item, i) => (
          <div title={'Record '+(i+1)} key={i}>{item}</div>
        ))
      }
    </div>
  );
};

export default Log;