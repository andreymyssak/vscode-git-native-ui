import { useEffect, useRef, useState } from 'react';

// A derived object feeds an effect, as options feed UI library subscriptions.
// Losing compiler memoization would recreate those options on unrelated updates.
export function CompilerProbe() {
  const [updates, setUpdates] = useState(0);
  const changes = useRef<HTMLOutputElement>(null);
  const options = { label: 'Derived options changes' };

  useEffect(() => {
    const node = changes.current;

    if (node) node.value = String(Number(node.value || 0) + 1);
  }, [options]);

  return (
    <>
      <button onClick={() => setUpdates((count) => count + 1)}>
        Update unrelated state
      </button>
      <span>Updates: {updates}</span>
      <output ref={changes} aria-label={options.label} />
    </>
  );
}
