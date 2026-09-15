import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { goBack } from './hooks/useBackClose.ts'
import { installBackGesture } from './services/native.ts'
import { installContentSecurityPolicy } from './security.ts'

// En premier : tout ce qui suit s'exécute sous la politique (voir `security.ts`).
installContentSecurityPolicy()

// Le geste retour ferme ce qui a été ouvert en dernier, et rien d'autre : il ne
// quitte jamais l'application (`hooks/useBackClose.ts`).
installBackGesture(() => {
  goBack()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
