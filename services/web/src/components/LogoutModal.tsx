import { LogOut } from 'lucide-react'

export default function LogoutModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}><div className="logout-modal" role="dialog" aria-modal="true" aria-labelledby="logout-title" onMouseDown={event=>event.stopPropagation()}><div className="logout-icon"><LogOut aria-hidden="true" /></div><h2 id="logout-title">Logout</h2><p>Are you sure you want to logout?</p><div><button onClick={onConfirm}>Yes</button><button onClick={onCancel}>Cancel</button></div></div></div>
}
