import React, { useSyncExternalStore } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { currentQueryClient, subscribeQueryClient, queryClientGeneration } from './lib/queryClient';
import App from './App';
import './styles.css';

function SessionQueries({ children }: { children: React.ReactNode }) {
  const qc = useSyncExternalStore(subscribeQueryClient, currentQueryClient);
  return <QueryClientProvider key={queryClientGeneration()} client={qc}>{children}</QueryClientProvider>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SessionQueries>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </SessionQueries>
  </React.StrictMode>,
);
