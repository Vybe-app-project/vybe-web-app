import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Refresh } from './icons';
import { EmptyState } from './ui';

type Props = {
  children: ReactNode;
  /** A change here (the route, in practice) clears a caught error so navigating away recovers. */
  resetKey?: string;
};
type State = { error: Error | null };

/**
 * Last line of defence for a render-time exception. Without one, React unmounts
 * the whole tree and the user is left on a blank page with nothing to do; with
 * it the shell stays, the broken screen says what happened and offers a way
 * out. The first story-viewer build blanked the app exactly this way.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Screen failed to render', error, info.componentStack);
  }

  componentDidUpdate(previous: Props) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) return <ErrorFallback error={this.state.error} onRetry={this.reset} />;
    return this.props.children;
  }
}

/** Route-aware boundary: leaving the broken screen recovers it. */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>;
}

export function ErrorFallback({ error, onRetry }: { error?: Error | null; onRetry: () => void }) {
  return (
    <div role="alert" className="mx-auto w-full max-w-md py-6" data-error={error?.name || undefined}>
      <EmptyState
        variant="error"
        title="Something went wrong"
        message="This screen hit a problem it couldn’t recover from. Try again, or head back to Home."
        action={{ label: 'Try again', onClick: onRetry, icon: <Refresh size={18} /> }}
        secondaryAction={{ label: 'Back to Home', to: '/' }}
      />
    </div>
  );
}
