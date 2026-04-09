import './ErrorMessage.css';

interface ErrorMessageProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorMessage({ message, onRetry }: ErrorMessageProps) {
  return (
    <div className="error-message">
      <div className="error-icon">!</div>
      <p className="error-text">{message}</p>
      {onRetry && (
        <button className="btn-retry" onClick={onRetry}>
          Erneut versuchen
        </button>
      )}
    </div>
  );
}
