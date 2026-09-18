import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './styles.css';

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err: any) => {
        // A 4xx is the API's final answer (bad input, no access, not found):
        // repeating it only stretches the skeleton for three seconds before
        // the same message. Retry when the server did not answer or 5xx'd.
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
