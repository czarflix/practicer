import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import '@fontsource/geist-sans/400.css'
import '@fontsource/geist-sans/500.css'
import '@fontsource/geist-sans/600.css'
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/500.css'
import './index.css'
import App from './App.jsx'
import { ThemeProvider } from './context/ThemeContext'
import { UserProvider } from './context/UserContext'
import { queryClient } from './lib/query-client'

const sessionStoragePersister = createSyncStoragePersister({
  storage: window.sessionStorage,
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: sessionStoragePersister,
        maxAge: 1000 * 60 * 30,
        buster: 'dsa-app-cache-v1',
      }}
    >
      <UserProvider>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </UserProvider>
    </PersistQueryClientProvider>
  </StrictMode>,
)
