import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './styles.css';

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry only what a retry can fix: network failures and 5xx. Any 4xx
      // (400 bad id, 429 rate limit, 401/403/404) is final, so the page shows
      // its error copy at once instead of a skeleton through three backoffs.
      retry: (count, err: any) => {
        const s = err?.response?.status;
        if (typeof s === 'number' && s < 500) return false;
        return count < 2;
      },
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
