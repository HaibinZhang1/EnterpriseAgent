export function EmptyState({ title, message }: { title: string; message?: string }) {
  return (
    <div className="state" role="status">
      <div>
        <strong>{title}</strong>
        {message ? <p>{message}</p> : null}
      </div>
    </div>
  );
}
