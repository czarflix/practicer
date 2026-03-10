import { BrowserRouter } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import { AppLayout } from './components/layout/AppLayout'

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <AppLayout />
      </BrowserRouter>
    </MotionConfig>
  )
}
