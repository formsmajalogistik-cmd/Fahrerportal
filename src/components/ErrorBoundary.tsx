import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** Fallback-UI. `reset` setzt die Boundary zurück, sodass das Kind neu rendert. */
  fallback: (args: { error: Error; reset: () => void }) => ReactNode;
  children: ReactNode;
  /** Optional: Identifier, der beim Wechsel die Boundary automatisch resettet. */
  resetKey?: string | number | null;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Zeigt den vollständigen Stack in der Browser-Console an, damit
    // unhandled Render-Fehler diagnostizierbar sind.
    console.error('[ErrorBoundary] React-Render-Fehler:', error);
    console.error('[ErrorBoundary] Component-Stack:', info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  reset = () => this.setState({ error: null });

  render(): ReactNode {
    if (this.state.error) {
      return this.props.fallback({ error: this.state.error, reset: this.reset });
    }
    return this.props.children;
  }
}
