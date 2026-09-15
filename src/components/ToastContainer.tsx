import { useToastStore } from "@/lib/toast";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function ToastContainer() {
  const { toasts, dismiss } = useToastStore();

  return (
    <div className="toast-container">
      {toasts.map((t) => {
        const icon = {
          success: <CheckCircle2 size={15} className="text-em" />,
          error: <AlertCircle size={15} className="toast-ic-err" />,
          warning: <AlertTriangle size={15} className="toast-ic-warn" />,
          info: <Info size={15} className="toast-ic-info" />,
        }[t.type];

        const cls = {
          success: "",
          error: "err",
          warning: "warn",
          info: "info",
        }[t.type];

        return (
          <div key={t.id} className={cn("toast", cls)}>
            {icon}
            <span>{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="toast-close"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
