import './LoadingSpinner.css';

interface LoadingSpinnerProps {
  text?: string;
}

export function LoadingSpinner({ text = 'Laden...' }: LoadingSpinnerProps) {
  return (
    <div className="loading-spinner">
      <div className="spinner" />
      <p>{text}</p>
    </div>
  );
}
