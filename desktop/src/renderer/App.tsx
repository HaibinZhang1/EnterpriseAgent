import { useEffect, useState } from 'react';

export function App() {
  const [status, setStatus] = useState('initializing');
  const [updateState, setUpdateState] = useState<string>();
  const [updateMessage, setUpdateMessage] = useState<string>();

  useEffect(() => {
    window.enterpriseAgent.device.getInfo().then((result) => {
      setStatus(result.success ? 'desktop backend ready' : result.error.message);
    });
    window.enterpriseAgent.clientUpdate.check().then((result) => {
      if (result.success && result.data && typeof result.data === 'object' && 'state' in result.data) {
        setUpdateState(String(result.data.state));
        setUpdateMessage('Client update available');
      }
    });
  }, []);

  const confirmDownload = async () => {
    const result = await window.enterpriseAgent.clientUpdate.confirmDownload();
    setUpdateState(result.success && result.data && typeof result.data === 'object' && 'state' in result.data ? String(result.data.state) : 'error');
    setUpdateMessage(result.success ? 'Update verified. Confirm install to launch.' : result.error.message);
  };

  const cancelUpdate = async () => {
    const result = await window.enterpriseAgent.clientUpdate.cancel('USER_CANCELLED');
    setUpdateState(result.success ? 'cancelled' : 'error');
    setUpdateMessage(result.success ? 'Update cancelled' : result.error.message);
  };

  const confirmInstall = async () => {
    const result = await window.enterpriseAgent.clientUpdate.confirmInstall();
    setUpdateState(result.success ? 'launched' : 'error');
    setUpdateMessage(result.success ? 'Installer launch confirmed' : result.error.message);
  };

  return (
    <main aria-label="Enterprise Agent Hub desktop smoke screen">
      <h1>Enterprise Agent Hub</h1>
      <p>{status}</p>
      {updateMessage ? (
        <section aria-label="Client update">
          <p>{updateMessage}</p>
          {updateState === 'available' ? (
            <>
              <button type="button" onClick={confirmDownload}>Download update</button>
              <button type="button" onClick={cancelUpdate}>Cancel update</button>
            </>
          ) : null}
          {updateState === 'verified' ? (
            <>
              <button type="button" onClick={confirmInstall}>Launch installer</button>
              <button type="button" onClick={cancelUpdate}>Cancel update</button>
            </>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
