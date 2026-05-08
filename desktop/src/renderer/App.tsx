import { useEffect, useState } from 'react';

export function App() {
  const [status, setStatus] = useState('initializing');

  useEffect(() => {
    window.enterpriseAgent.device.getInfo().then((result) => {
      setStatus(result.success ? 'desktop backend ready' : result.error.message);
    });
  }, []);

  return (
    <main aria-label="Enterprise Agent Hub desktop smoke screen">
      <h1>Enterprise Agent Hub</h1>
      <p>{status}</p>
    </main>
  );
}
