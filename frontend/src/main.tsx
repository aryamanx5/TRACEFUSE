import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import AppShell from './components/AppShell'
import { Spinner } from './components/ui'

const Landing = lazy(() => import('./pages/Landing'))
const Overview = lazy(() => import('./pages/Overview'))
const NewInvestigation = lazy(() => import('./pages/NewInvestigation'))
const Workspace = lazy(() => import('./pages/Workspace'))
const Cases = lazy(() => import('./pages/Cases'))
const CaseDetail = lazy(() => import('./pages/CaseDetail'))
const Historical = lazy(() => import('./pages/Historical'))
const Challenge = lazy(() => import('./pages/Challenge'))
const Status = lazy(() => import('./pages/Status'))

export function AppRoutes() {
  return (
    <Suspense fallback={<div className="p-6"><Spinner /></div>}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<AppShell />}>
          <Route index element={<Overview />} />
          <Route path="new" element={<NewInvestigation />} />
          <Route path="investigations/:id" element={<Workspace />} />
          <Route path="cases" element={<Cases />} />
          <Route path="cases/:id" element={<CaseDetail />} />
          <Route path="historical" element={<Historical />} />
          <Route path="challenge" element={<Challenge />} />
          <Route path="challenge/:id" element={<Challenge />} />
          <Route path="status" element={<Status />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  </StrictMode>,
)
