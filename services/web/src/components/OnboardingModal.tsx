import { BarChart3, BellRing, MessageSquareText } from 'lucide-react'
import Modal from './Modal'

export default function OnboardingModal({ onClose }: { onClose: () => void }) {
  return <Modal title="Welcome to Kea Energy" onClose={onClose} footer={<button className="primary-action" onClick={onClose}>Explore dashboard</button>}><div className="onboarding-grid"><article><BarChart3/><h3>Understand usage</h3><p>Explore daily, weekly and monthly patterns in kWh or estimated dollars.</p></article><article><BellRing/><h3>Avoid bill shock</h3><p>See projected costs and clear high-usage alerts before the bill arrives.</p></article><article><MessageSquareText/><h3>Ask Sparky</h3><p>Use guided questions or start a conversation about your energy account.</p></article></div></Modal>
}
