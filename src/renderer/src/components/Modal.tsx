import { ReactNode } from "react";
import { XCircle } from "lucide-react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  width?: string;
  icon?: ReactNode;
  disableClose?: boolean;
}

export default function Modal({ isOpen, onClose, title, children, width = "min(580px, 92vw)", icon, disableClose = false }: ModalProps) {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        backdropFilter: "blur(4px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !disableClose) onClose();
      }}
    >
      <div
        style={{
          background: "var(--bg-card)",
          borderRadius: "16px",
          padding: "24px 28px",
          width,
          boxShadow: "var(--shadow-lg)",
          border: "1px solid var(--border-subtle)",
          maxHeight: "90vh",
          overflowY: "auto",
          backdropFilter: "blur(10px)"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
          <h3 style={{ fontSize: "1.125rem", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: "8px", color: "var(--text-primary)" }}>
            {icon}
            {title}
          </h3>
          <button
            style={{ background: "none", border: "none", color: disableClose ? "var(--border-subtle)" : "var(--text-muted)", cursor: disableClose ? "not-allowed" : "pointer", transition: "color 0.2s" }}
            onClick={() => { if (!disableClose) onClose(); }}
            disabled={disableClose}
            onMouseOver={(e) => { if (!disableClose) e.currentTarget.style.color = "var(--text-primary)"; }}
            onMouseOut={(e) => { if (!disableClose) e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            <XCircle size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
