import { Component } from 'react';

// Catches render-time crashes so the app shows an error instead of a blank
// (black, in dark mode) screen. Lets the user recover without restarting.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('App crashed:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-white dark:bg-neutral-950 text-center">
        <div className="max-w-md">
          <h2 className="text-xl font-semibold mb-2 text-red-600 dark:text-red-400">Something went wrong</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4 break-words">
            {String(this.state.error?.message || this.state.error)}
          </p>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            className="px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
